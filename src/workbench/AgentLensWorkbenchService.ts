import { parallelBySize } from "../runtime/TransferPool";
import type { ManualSaveOptions, SaveTransferProgress } from "./types";
import { syncDestinations } from "../runtime/DestinationConfigurationSync";
import { FollowConfigurationOutbox, type FollowConfigurationPatch } from "../runtime/FollowConfigurationOutbox";
import { pinterestBoardUrl } from "../core/pinterest-board";
import { buildDiagnosticPackage } from "../diagnostics/export";
import { activeDiagnosticLog } from "../diagnostics/log";
import { MediaDownloadError, MediaRecoveryError } from "../core/mediaFailure";
import { hostExecutionLocks } from "../runtime/HostExecutionLocks";
import { nextFixedSlot } from "../auto-fetch/schedule-slots";
import { AgentLensError } from "../core/errors";
import { OperationStore, type OperationScope } from "../auto-fetch/operation-store";
import { AutoFetchActivityTracker } from "./AutoFetchActivity";
import { ImportTasks, type ImportTaskContext, type ImportTask } from "./ImportTasks";

import { SINGLE_DEMO_LINK, BULK_DEMO_LINK } from "../core/demoLinks";
import { SINGLE_FETCH_REVIEW, requireFullRelease } from "../core/releaseProfile";
import { publicLinkFromText } from "../core/urls";
import type { AutoFetchCapabilities, AccountSummary, ActivityDetail, ActivityExport, ActivityFilters, ActivityPage, CreatorParseResult, CreatorRecord, CreatorSchedulePreview, CreatorSettingsInput, FetchPage, SchedulerReconcileReason } from "../api/AgentLensApiClient";
import type { AuthState } from "../auth/AuthService";
import { AuthService } from "../auth/AuthService";
import type { MediaPolicy, NormalizedPost, PersistedLedgerEntry } from "../core/domain";
import { contentKey } from "../core/domain";
import { recordCreatorSavedPageInState, PluginStateStore, type PluginUiPreferences } from "../runtime/PluginStateStore";
import type { NoteWriteManifest, VaultWriteResult } from "../vault/VaultWriter";
import { VaultWriter } from "../vault/VaultWriter";
import { RequestCoordinator } from "../runtime/RequestCoordinator";
import type { AccountCapabilities } from "../api/contracts";
import { requirePublicLink } from "../api/PlatformCapabilityGuard";
import { compareVersions } from "../core/versions";
import type { AgentLensApiPort, AgentLensWorkbenchPort, MediaDownloaderPort } from "./ports";
import type { BatchSaveResult, FollowCreatorInput, PreparedSave, PreviewResult, SaveResult, SchedulerRunResult, WriteOptions } from "./types";
import { DurableActionStore } from "./DurableActionStore";
import { SchedulerCoordinator } from "./SchedulerCoordinator";
import { FollowConfigurationSync } from "../runtime/FollowConfigurationSync";
import type { NativeExecutionTarget } from "../runtime/NativeExecutionTarget";
import { remoteScope } from "./identifiers";
import { writeResult } from "./writeResults";
import type { BillingPort } from "../api/billing";

export type { BatchSaveResult, FollowCreatorInput, PreparedSave, PreviewResult, SaveResult, SchedulerRunResult, WriteOptions } from "./types";

export const DEMO_URL = SINGLE_DEMO_LINK;

export class AgentLensWorkbenchService implements AgentLensWorkbenchPort {
  readonly billing: BillingPort = {
    plans: async () => (await this.billingApi()).plans(),
    dashboard: async () => (await this.billingApi()).dashboard(),
    createIntent: async selection => (await this.billingApi()).createIntent(selection),
    intent: async id => (await this.billingApi()).intent(id),
    paymentOptions: async (plan, cycle) => (await this.billingApi()).paymentOptions!(plan, cycle),
    pendingCheckout: async () => (await this.billingApi()).pendingCheckout!(),
    checkout: async (id, method, confirmation) => (await this.billingApi()).checkout(id, method, confirmation),
    change: async (action, plan, cycle) => (await this.billingApi()).change(action, plan, cycle),
    portal: async () => (await this.billingApi()).portal(),
    subscription: async action => (await this.billingApi()).subscription(action)
  };

  private async billingApi(): Promise<BillingPort> {
    const token = await this.requireAccessToken();
    if (!this.api.billing) throw new Error("Billing is unavailable.");
    return this.api.billing(token);
  }
  private readonly manualSaves = new Set<AbortController>();
  isManualSaving(): boolean { return this.manualSaves.size > 0; }
  cancelManualSaves(): void { for (const controller of this.manualSaves) controller.abort(); }

  private readonly importTaskJournal: ImportTasks;
  private taskIdentity?: { token: string; accountId: string };

  private readonly durableActions: DurableActionStore;
  private readonly scheduler: SchedulerCoordinator;
  private readonly autoActivity = new AutoFetchActivityTracker();
  subscribeAccountChanges(listener: () => void): () => void {
    return this.autoActivity.subscribeSourceSettled(listener);
  }
  autoFetchActivity(creatorId: string, folderPath?: string) {
    if (!this.indexedOperations) return this.autoActivity.get(creatorId);
    const session = this.projectionSession;
    if (!session || session.epoch !== this.auth.sessionEpoch() || folderPath === undefined) return {};
    return this.autoActivity.get({ userId: session.userId, installationId: session.installationId,
      creatorId, epoch: session.epoch, folderPath });
  }
  private diagnosticSession?: { userId: string; installationId: string; epoch: number; token: string };
  private projectionSession?: { userId: string; installationId: string; epoch: number; token: string };
  subscribeAutoFetchActivity(listener: () => void) {
    const activity = this.autoActivity.subscribe(listener), stored = this.indexedOperations?.subscribe(listener);
    return () => { activity(); stored?.(); };
  }

  private async readAutoFetchHistory<T>(creatorId: string, read: (store: OperationStore, scope: OperationScope) => Promise<T>): Promise<T> {
    requireFullRelease();
    const session = this.projectionSession;
    const store = this.indexedOperations;
    if (!session || !store) throw new Error("Open Auto-Fetch before reading local tasks.");
    const current = async () => this.auth.sessionEpoch() === session.epoch && await this.auth.accessToken() === session.token;
    if (!await current()) throw new Error("The account changed before task history could be read.");
    const result = await read(store, { userId: session.userId, installationId: session.installationId, creatorId });
    if (!await current()) throw new Error("The account changed before task history could be read.");
    return result;
  }

  async exportLocalDiagnostics() {
    requireFullRelease();
    const session = this.diagnosticSession ?? this.projectionSession, operations = this.indexedOperations;
    if (!session || !operations) throw new Error("Refresh your account before exporting local diagnostics.");
    const assertCurrent = async () => {
      if (this.auth.sessionEpoch() !== session.epoch || await this.auth.accessToken() !== session.token)
        throw new Error("The account changed during diagnostic export.");
    };
    return buildDiagnosticPackage({ scope: { userId: session.userId, installationId: session.installationId },
      operations, log: activeDiagnosticLog(), assertCurrent });
  }

  autoFetchTaskHistory(creatorId: string, folderPath: string, after?: { sequence: number }) {
    return this.readAutoFetchHistory(creatorId, (store, scope) => store.taskHistory(scope, folderPath, 25, after));
  }

  autoFetchTaskDetail(creatorId: string, folderPath: string, operationId: string, after?: { pageNumber: number }) {
    return this.readAutoFetchHistory(creatorId, (store, scope) => store.taskDetail(scope, folderPath, operationId, 10, after));
  }

  async refreshAutoFetchCreators(creators: readonly CreatorRecord[]): Promise<readonly CreatorRecord[]> {
    const session = this.projectionSession;
    if (!this.indexedOperations || !session) return creators;
    const current = async () => this.auth.sessionEpoch() === session.epoch && await this.auth.accessToken() === session.token;
    if (!await current()) throw new Error("The account changed before Auto-Fetch could refresh.");
    const projected = await Promise.all(creators.map(async creator => {
      const scope = { userId: session.userId, installationId: session.installationId, creatorId: creator.creatorId };
      const [statistics, localStatus] = await Promise.all([
        this.indexedOperations!.creatorStatistics(scope), this.indexedOperations!.creatorStatus(scope, creator.saveFolderPath)
      ]);
      let nextCheckAt = creator.nextCheckAt;
      if (!creator.autoFetchEnabled) nextCheckAt = null;
      else if (creator.scheduleAnchorAt) nextCheckAt = nextFixedSlot({ revision: creator.configRevision ?? 1,
        anchorAt: creator.scheduleAnchorAt, effectiveAt: creator.scheduleAnchorAt,
        frequencyEvery: creator.frequency.every, frequencyUnit: creator.frequency.unit,
        autoFetchEnabled: true, deleted: false, legacySnapshot: false }, new Date().toISOString()).at;
      const success = localStatus.lastSuccessfulCheckAt;
      return { ...creator, ...statistics, localStatus, nextCheckAt,
        lastSuccessfulCheckAt: success && (!creator.lastSuccessfulCheckAt || Date.parse(success) > Date.parse(creator.lastSuccessfulCheckAt))
          ? success : creator.lastSuccessfulCheckAt ?? null };
    }));
    if (!await current()) throw new Error("The account changed before Auto-Fetch could refresh.");
    return projected;
  }

  constructor(
    private readonly auth: AuthService,
    private readonly api: AgentLensApiPort,
    private vaultWriter: VaultWriter,
    private readonly stateStore: PluginStateStore,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly mediaDownloader?: MediaDownloaderPort | undefined,
    private readonly createVaultWriter?: ((options: {
      folderPath?: string | undefined;
      mediaPolicy?: MediaPolicy | undefined;
      templateId?: "default" | "compact" | undefined;
    }) => VaultWriter) | undefined,
    private readonly requests: RequestCoordinator = new RequestCoordinator(),
    private readonly indexedOperations?: OperationStore,
    private readonly executionTarget?: () => Promise<NativeExecutionTarget | undefined>
  ) {
    this.importTaskJournal = new ImportTasks(stateStore);

    this.durableActions = new DurableActionStore(stateStore, createId);
    this.scheduler = new SchedulerCoordinator(auth, api, this.durableActions, requests, createId, {
      requireSupportedVersion: (accessToken) => this.requireSupportedVersion(accessToken),
      flushPendingWrites: (accessToken) => this.flushPendingWrites(accessToken),
      flushPendingCallbacks: (accessToken) => this.flushPendingCallbacks(accessToken),
      saveMany: (previews, options) => this.saveMany(previews, options),
      planPreview: (preview, options) => this.planPreview(preview, options),
      writeLocal: (preview, manifest, task) => this.writeLocal(preview, manifest, task?.signal, task),
      confirmIndexedWrite: (preview, reuse) => this.confirmIndexedWrite(preview, reuse)
    }, this.autoActivity, indexedOperations ? { store: indexedOperations,
      sharedDestinationReady: async (session, creator) => {
        const target=await this.executionTarget?.();if(!target || target.targetId!==session.targetId)return false;
        const state=await stateStore.load();
        const settingsKey=JSON.stringify([session.userId,session.installationId,"obsidian",target.targetId]);
        const config=state.sharedSettings?.[settingsKey]?.find(v=>v.followId===creator.followId);
        const key=JSON.stringify([session.userId,session.installationId,"obsidian",target.targetId,creator.followId]);
        const adopted=state.sharedFolderAdoptions?.[key];
        return !!config && config.relativeFolderPath===creator.saveFolderPath && adopted?.revision===config.pathRevision && !adopted.invalid;
      },
      destinationAvailable: async (session, operation) => {
        if (!this.executionTarget) return true;
        const target = await this.executionTarget();
        if (!target || session.targetId && target.targetId !== session.targetId) return false;
        const state = await stateStore.load();
        const key = JSON.stringify([session.userId,session.installationId,"obsidian",target.targetId,operation.snapshot.followId]);
        return state.sharedFolderAdoptions?.[key]?.invalid !== true && target.healthy && target.writable
          && !!target.folders?.some(f => f.path === operation.snapshot.saveFolderPath);
      },
      configurationReady: async (session, followId) => {
        if (auth.sessionEpoch() !== session.epoch || await auth.accessToken() !== session.accessToken) return false;
        const state = await stateStore.load();
        return state.installationId === session.installationId && !(state.followConfigurationOutbox ?? []).some(command =>
          command.owner === session.userId && command.installationId === session.installationId && command.followId === followId && !command.resolution);
      },
      session: async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        throw new Error("AgentLens is offline. Reconnect before checking again.");
      const epoch = auth.sessionEpoch();
      const accessToken = await auth.accessToken();
      if (!accessToken) return undefined;
      const { accountId } = await this.requireSupportedVersion(accessToken);
      const state = await stateStore.load();
      const target = await this.executionTarget?.();
      if (auth.sessionEpoch() !== epoch || await auth.accessToken() !== accessToken)
        throw new Error("The account session changed; scheduler recovery is deferred.");
      return { userId: accountId, installationId: state.installationId, accessToken, epoch,
        sequenceFloor: state.schedulerSequence ?? 0, ...(target ? { targetId: target.targetId } : {}) };
    } } : undefined, this.importTaskJournal);

  }


  subscribeImportTasks(listener: () => void): () => void {
    const unsubscribeTasks = this.importTaskJournal.subscribe(listener);
    const unsubscribeAuth = this.auth.subscribe(() => listener());
    return () => { unsubscribeTasks(); unsubscribeAuth(); };
  }

  private async importTaskAccount(): Promise<string> {
    const token = await this.requireAccessToken();
    if (this.taskIdentity?.token !== token) await this.requireSupportedVersion(token);
    if ((await this.auth.accessToken()) !== token || this.taskIdentity?.token !== token) throw new Error("The account changed. Refresh task history.");
    return this.taskIdentity.accountId;
  }

  async importTasks(): Promise<readonly ImportTask[]> {
    return this.importTaskJournal.recent(await this.importTaskAccount());
  }

  async importTaskHistory(cursor?: string, filter?: import("./ImportTasks").ImportTaskFilter) {
    return this.importTaskJournal.history(await this.importTaskAccount(), cursor, filter);
  }

  async cancelImportTask(id: string): Promise<void> {
    const current = this.auth.snapshot();
    const accountId = current.status === "signed_in" && this.taskIdentity?.token === current.accessToken
      ? this.taskIdentity.accountId : await this.importTaskAccount();
    await this.importTaskJournal.cancel(id, accountId);
  }

  async retryImportTask(id: string): Promise<void> {
    return this.requests.runExclusive(`import-task-retry:${id}`, async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("Reconnect before retrying this task.");
      const accountId = await this.importTaskAccount();
      const task = await this.importTaskJournal.get(id, accountId);
      const checkpoint = (await this.durableActions.schedulerCheckpoints(accountId)).find(item => item.id === id);
      if (checkpoint) { await this.scheduler.retryTask(id); return; }
      const failed = task.notes.filter(note => ["failed", "cancelled", "waiting"].includes(note.phase));
      if (!failed.length) throw new Error("This task has no failed files to retry.");
      await this.importTaskJournal.run(task.checkpoint, async context => {
        for (const note of failed) {
          context.signal.throwIfAborted();
          const token = await this.requireAccessToken();
          if ((await this.importTaskAccount()) !== accountId) throw new Error("The account changed before retrying.");
          const manifest = await this.planPreview(note.preview, { folderPath: task.folderPath,
            templateId: note.manifest.templateId, mediaPolicy: note.manifest.mediaPolicy, targetNotePath: note.path });
          const write = await this.writeLocal(note.preview, manifest, context.signal, context);
          if (note.preview.fetchId && !note.preview.indexedWrite) {
            const pending = (await this.durableActions.pendingWrites()).filter(item => item.request?.fetchRunId === task.checkpoint.lease.leaseId && contentKey(item.preview.post) === manifest.contentKey);
            await this.durableActions.queueCallback({ fetchId: note.preview.fetchId, runId: task.checkpoint.lease.leaseId,
              creatorId: task.creatorId, fetchRunId: task.checkpoint.lease.leaseId, results: [writeResult(write)] },
              remoteScope("task-local-result", JSON.stringify([id, manifest.contentKey, manifest.managedDigest, write.ledger.completion, write.ledger.media.map(item => [item.mediaKey, item.status])])), pending.map(item => item.id));
            await this.flushPendingCallbacks(token);
          }
        }
        return true;
      }, true);
    });

  }

  authState(): Readonly<AuthState> {
    return this.auth.snapshot();
  }

  clientVersion(): string {
    return this.api.currentClientVersion();
  }

  subscribeAuth(listener: (state: Readonly<AuthState>) => void): () => void {
    return this.auth.subscribe(listener);
  }

  restoreAuth(force = false): Promise<AuthState> {
    return this.auth.restore(force);
  }

  startSignIn(provider?: "google", intent?: import("../auth/AuthService").DeviceAuthorizationIntent): Promise<AuthState> {
    return this.auth.start(provider, intent);
  }

  requestPasswordReset(email: string): Promise<string> {
    if (!this.api.requestPasswordReset) return Promise.reject(new Error("Password reset is unavailable."));
    return this.api.requestPasswordReset(email);
  }

  signInWithEmail(credentials: import("../auth/AuthService").EmailCredentials): Promise<AuthState> {
    return this.auth.startWithEmail(credentials);
  }

  pollSignIn(): Promise<AuthState> {
    return this.auth.pollOnce();
  }

  cancelPendingSignIn(): Promise<void> { return this.auth.cancelPendingSignIn(); }

  signOut(): Promise<void> {
    this.cancelManualSaves();
    return this.auth.signOut();
  }

  publicPlatformCatalog() {
    if (!this.api.publicPlatformCatalog) return Promise.reject(new Error("Platform catalog unavailable"));
    return this.api.publicPlatformCatalog();
  }

  async capabilities(): Promise<AccountCapabilities> {
    const token = await this.requireAccessToken();
    return this.api.capabilities(token);
  }

  async account(): Promise<AccountSummary> {
    const token = await this.requireAccessToken();
    const epoch = this.auth.sessionEpoch();
    const account = await this.api.account(token);
    const { installationId } = await this.stateStore.load();
    if (this.auth.sessionEpoch() !== epoch || await this.auth.accessToken() !== token)
      throw new Error("The account changed before account information could be read.");
    this.diagnosticSession = { userId: account.user.id, installationId, epoch, token };
    return account;
  }

  uiPreferences(): Promise<PluginUiPreferences> {
    return this.stateStore.uiPreferences();
  }

  setUiPreferences(patch: Readonly<PluginUiPreferences>): Promise<void> {
    return this.stateStore.patchUiPreferences(patch);
  }

  async activity(filters: ActivityFilters, cursor: string | null = null, through?: string): Promise<ActivityPage> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    return this.api.activity(token, filters, cursor, 25, through);
  }

  async activityDetail(activityId: string): Promise<ActivityDetail> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    return this.api.activityDetail(token, activityId);
  }

  async exportActivity(filters: ActivityFilters): Promise<ActivityExport> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    return this.api.exportActivity(token, filters);
  }

  subscribeFollowConfiguration(listener: (ids: string[]) => void): () => void {
    let previous = "";
    const publish = (state: Readonly<import("../runtime/PluginStateStore").AgentLensPluginState>) => {
      const session = this.auth.snapshot();
      const ids = session.status === "signed_in" && this.taskIdentity?.token === session.accessToken
        ? [...new Set((state.followConfigurationOutbox ?? []).filter(c => c.owner === this.taskIdentity!.accountId && c.installationId === state.installationId && !c.resolution).map(c => c.followId))] : [];
      const key = JSON.stringify(ids); if (key !== previous) {previous = key; listener(ids);}
    };
    const unsubscribe = this.stateStore.subscribe(publish);
    void this.stateStore.load().catch(() => listener([]));
    return unsubscribe;
  }

  private syncQueuedFollowConfiguration(): void {
    if (window.navigator?.onLine === false) return;
    void this.requests.runExclusive("follow:configuration-sync", async () => {
      const epoch = this.auth.sessionEpoch(), token = await this.auth.accessToken();
      if (!token) return;
      const {accountId} = await this.requireSupportedVersion(token);
      await new FollowConfigurationSync(this.api, this.stateStore).run(accountId, token,
        async () => this.auth.sessionEpoch() === epoch && await this.auth.accessToken() === token);
    }).catch(() => { /* Pending commands retain their original identity until acknowledged. */ });
  }

  async queueFollowConfiguration(followId: string, patch: FollowConfigurationPatch): Promise<string> {
    requireFullRelease();
    const session = this.auth.snapshot();
    if (session.status !== "signed_in" || !this.taskIdentity || this.taskIdentity.token !== session.accessToken)
      throw new Error("Verify the current account before editing offline configuration.");
    const id = await new FollowConfigurationOutbox(this.stateStore, this.createId, () => this.auth.snapshot() === session).enqueue(this.taskIdentity.accountId, followId, patch, true);
    this.syncQueuedFollowConfiguration();
    return id;
  }

  async queueFollowDeletion(followId: string): Promise<string> {
    requireFullRelease();
    const session = this.auth.snapshot();
    if (session.status !== "signed_in" || !this.taskIdentity || this.taskIdentity.token !== session.accessToken)
      throw new Error("Verify the current account before deleting an offline configuration.");
    const id = await new FollowConfigurationOutbox(this.stateStore, this.createId, () => this.auth.snapshot() === session).enqueueDelete(this.taskIdentity.accountId, followId, true);
    this.syncQueuedFollowConfiguration();
    return id;
  }

  async unfollowAccount(followId: string): Promise<void> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    // This account-owned DELETE is server-idempotent. Do not enqueue another
    // operation or discard local task/write evidence after removing the Follow.
    await this.api.unfollowAccount(token, followId);
  }

  async accountFollows() {
    requireFullRelease();
    return this.api.accountFollows(await this.requireAccessToken());
  }

  async scheduleHistory(followId: string, afterRevision = 0, throughRevision?: number) {
    requireFullRelease();
    const token = await this.requireAccessToken();
    return this.api.scheduleHistory(token, followId, afterRevision, throughRevision);
  }

  async autoFetchSetup(): Promise<{
    autoFetchCapabilities: AutoFetchCapabilities;
    settings: { homeTimezone: string | null; confirmed: boolean };
    creators: readonly CreatorRecord[];
  }> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    const epoch = this.auth.sessionEpoch();
    if (this.executionTarget) await syncDestinations(this.api, this.stateStore, await this.importTaskAccount(), token, this.executionTarget,
      async () => this.auth.sessionEpoch() === epoch && await this.auth.accessToken() === token);
    const [settings, creators, autoFetchCapabilities] = await Promise.all([
      this.api.settings(token),
      this.api.listCreators(token),
      this.api.autoFetchCapabilities(token)
    ]);
    const accountId = await this.importTaskAccount();
    if ((await this.auth.accessToken()) !== token) throw new Error("The account changed. Refresh task history.");
    await this.importTaskJournal.rememberCreators(creators, accountId);
    if (!this.indexedOperations) return { settings, autoFetchCapabilities, creators: await this.stateStore.mergeCreatorDiagnostics(creators) };
    const { installationId } = await this.stateStore.load();
    if (this.auth.sessionEpoch() !== epoch || await this.auth.accessToken() !== token)
      throw new Error("The account changed before Auto-Fetch could refresh.");
    this.projectionSession = { userId: accountId, installationId, epoch, token };
    const projected = await this.refreshAutoFetchCreators(creators);
    if (this.auth.sessionEpoch() !== epoch || await this.auth.accessToken() !== token)
      throw new Error("The account changed before Auto-Fetch could refresh.");
    return { settings, autoFetchCapabilities, creators: projected };

  }

  async confirmTimezone(timezone: string): Promise<void> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    await this.api.confirmTimezone(token, timezone);
  }

  async parseCreator(profileUrl: string): Promise<CreatorParseResult> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    requirePublicLink(profileUrl);
    profileUrl = pinterestBoardUrl(profileUrl, true);
    await this.requireSupportedVersion(token);
    return this.durableActions.runRemoteAction(
      remoteScope("creator-parse", profileUrl),
      "creator-parse",
      ({ idempotencyKey }) => this.api.parseCreator(token, profileUrl, idempotencyKey)
);
  }

  async followCreator(input: FollowCreatorInput): Promise<CreatorRecord> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    const startedAt = new Date().toISOString();
    const creator = await this.durableActions.runRemoteAction(
      remoteScope("creator-create", JSON.stringify(input)),
      "creator-create",
      ({ idempotencyKey }) => this.api.createCreator(token, input, idempotencyKey)
    );
    if (await this.auth.accessToken() === token) await this.scheduler.registerNewCreator(creator, startedAt);
    return creator;

  }

  async setCreatorEnabled(creatorId: string, enabled: boolean): Promise<CreatorRecord> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    const epoch = this.auth.sessionEpoch();
    const { accountId } = await this.requireSupportedVersion(token);
    const previous = this.indexedOperations && enabled ? (await this.api.listCreators(token)).find(item => item.creatorId === creatorId) : undefined;
    const { installationId } = await this.stateStore.load();
    const updated = await this.durableActions.runRemoteAction(
      remoteScope("creator-toggle", `${creatorId}:${enabled}`),
      "creator-toggle",
      ({ idempotencyKey }) => this.api.updateCreator(token, creatorId, enabled, idempotencyKey)
    );
    if (this.auth.sessionEpoch() !== epoch || await this.auth.accessToken() !== token)
      throw new Error("The account changed before Auto-Fetch could refresh.");
    if (this.indexedOperations && previous && !previous.autoFetchEnabled && updated.autoFetchEnabled)
      await this.indexedOperations.resetCreatorStatus({ userId: accountId, installationId, creatorId }, new Date().toISOString());
    return (await this.refreshAutoFetchCreators([updated]))[0]!;

  }

  async previewCreatorSettings(
    creatorId: string,
    input: CreatorSettingsInput
): Promise<CreatorSchedulePreview> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    return this.api.previewCreatorSettings(token, creatorId, input);
  }

  async updateCreatorSettings(
    creatorId: string,
    input: CreatorSettingsInput,
    previewToken: string
): Promise<CreatorRecord> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    return this.durableActions.runRemoteAction(
      remoteScope("creator-settings", `${creatorId}:${previewToken}:${JSON.stringify(input)}`),
      "creator-settings",
      ({ idempotencyKey }) => this.api.updateCreatorSettings(token, creatorId, input, previewToken, idempotencyKey)
);
  }

  async deleteCreator(creatorId: string): Promise<void> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    await this.durableActions.runRemoteAction(
      remoteScope("creator-delete", creatorId),
      "creator-delete",
      ({ idempotencyKey }) => this.api.deleteCreator(token, creatorId, idempotencyKey)
);
  }

  retryCreator(creator: CreatorRecord): Promise<SchedulerRunResult> {
    requireFullRelease();
    return this.scheduler.retryCreator(creator);
  }

  setVaultWriter(writer: VaultWriter): void {
    this.vaultWriter = writer;
  }

  async previewSingle(url: string): Promise<PreviewResult> {
    url = publicLinkFromText(url);
    const epoch = this.auth.sessionEpoch();
    return this.requests.runExclusive(`single-fetch:${epoch}:${url}`, async () => {
      const result = await this.previewSingleOnce(url);
      if (epoch !== this.auth.sessionEpoch()) throw new Error("The account changed while parsing this post. Please parse it again.");
      return result;
    });
  }

  private async previewSingleOnce(url: string): Promise<PreviewResult> {
    const token = await this.auth.accessToken();
    if (!token && url === SINGLE_DEMO_LINK) {
      if (!this.api.demoFetch) throw new Error("Demo is unavailable. Please update the plugin.");
      const result = await this.api.demoFetch("single_post");
      const post = result.content[0];
      if (!post) throw new Error("AgentLens returned no demo content.");
      return { post, usage: result.usage, demo: true };
    }
    if (!token) throw new Error("Sign in before fetching a live source.");
    requirePublicLink(url);
    await this.requireSupportedVersion(token);
    const result: FetchPage = await this.durableActions.runRemoteAction(
      remoteScope("single-fetch", url),
      "single-fetch",
      ({ idempotencyKey, requestId }) => this.api.fetch(
        token,
        { url, mode: "single_post" },
        idempotencyKey,
        requestId
)
);
    const post = result.content[0];
    if (!post) throw new Error("AgentLens returned no content for this URL.");
    return {
      post,
      fetchId: result.fetchId,
      usageRemaining: result.usage.remaining,
      usage: result.usage,
      demo: false
    };
  }

  async restoreHistory(fetchId: string): Promise<FetchPage> {
    const epoch = this.auth.sessionEpoch();
    const writer = this.vaultWriter;
    const token = await this.auth.accessToken();
    if (!token) throw new Error("Sign in with the original account in its original vault before restoring a list.");
    if (!this.api.restoreHistory) throw new Error("History restoration is unavailable. Please update the plugin.");
    const page = await this.api.restoreHistory(token, fetchId.trim());
    if (epoch !== this.auth.sessionEpoch() || writer !== this.vaultWriter)
      throw new Error("The account or destination changed while restoring the list.");
    if (page.fetchId !== fetchId.trim() || page.mode !== "profile_page") throw new Error("The saved list identity does not match the original request.");
    return { ...page, historyRestore: true };
  }

  async supplementContent(preview: PreviewResult): Promise<PreviewResult> {
    if (preview.demo || preview.post.needSupplement !== true) return preview;
    if (preview.historyRestore) throw new Error("This saved post is incomplete. History restoration never requests new details.");
    if (!preview.fetchId || !preview.post.supplementUrl) throw new Error("The source did not provide a post URL for supplementation.");
    const token = await this.auth.accessToken();
    if (!token) throw new Error("Sign in before opening live post details.");
    if (!this.api.supplementContent) throw new Error("Post supplementation is unavailable. Please update the plugin.");
    const post = await this.api.supplementContent(token, preview.fetchId, preview.post);
    if (token !== await this.auth.accessToken()) throw new Error("The session changed while loading post details.");
    return { ...preview, post };
  }

  async fetchProfilePage(url: string, cursor: string | null): Promise<FetchPage> {
    url = pinterestBoardUrl(url);
    url = publicLinkFromText(url);
    const epoch = this.auth.sessionEpoch();
    return this.requests.runExclusive(
      `profile-fetch:${epoch}:${url}:${cursor ?? "first"}`,
      async () => {
        const result = await this.fetchProfilePageOnce(url, cursor);
        if (epoch !== this.auth.sessionEpoch()) throw new Error("The account changed while parsing this profile. Please parse it again.");
        return result;
      }
);
  }

  private async fetchProfilePageOnce(url: string, cursor: string | null): Promise<FetchPage> {
    const token = await this.auth.accessToken();
    if (!token && url.toLowerCase().replace(/\/$/, "") === BULK_DEMO_LINK.toLowerCase().replace(/\/$/, "")) {
      if (!this.api.demoFetch) throw new Error("Demo is unavailable. Please update the plugin.");
      return this.api.demoFetch("profile_page", cursor);
    }
    if (!token) throw new Error("Sign in before fetching a creator profile.");
    requirePublicLink(url);
    await this.requireSupportedVersion(token);
    return this.durableActions.runRemoteAction(
      remoteScope("profile-fetch", `${url}:${cursor ?? "first"}`),
      "profile-fetch",
      ({ idempotencyKey, requestId }) => this.api.fetch(
        token,
        { url, mode: "profile_page", ...(cursor ? { cursor } : {}) },
        idempotencyKey,
        requestId
),
      // The server binds a continuation to its first consumer key, even when
      // that page fails validation. Retrying must retain that same identity.
      { retainIdentityOnFailure: Boolean(cursor) }
);
  }

  async plan(
    post: NormalizedPost,
    options: WriteOptions & { fetchId?: string | undefined; fetchedAt?: string | undefined } = {},
    receipt?: PersistedLedgerEntry
  ): Promise<NoteWriteManifest> {

    const writer = this.createVaultWriter && (options.folderPath !== undefined || options.mediaPolicy || options.templateId)
      ? this.createVaultWriter(options)
      : this.vaultWriter;
    const previous = receipt ?? (await this.stateStore.load()).ledger[contentKey(post)];
    const folder = options.folderPath?.replace(/\/$/, "");
    const sameDestination = previous && (folder === undefined || (folder === "" ? !previous.notePath.includes("/") : previous.notePath.startsWith(`${folder}/`)));
    const existingMediaPaths = sameDestination && !options.saveAsCopy ? Object.fromEntries((previous.media ?? [])
      .filter(item => item.status === "saved" || item.status === "skipped")
      .map(item => [item.mediaKey.slice(`${contentKey(post)}:media:`.length), item.path])) : {};
    return writer.plan(post, { fetchId: options.fetchId, fetchedAt: options.fetchedAt, existingMediaPaths,
      existingMediaNotePath: sameDestination ? previous.notePath : undefined,
      saveAsCopy: options.saveAsCopy, targetNotePath: options.targetNotePath });
  }

  async planPreview(
    preview: PreviewResult,
    options: WriteOptions = {}
  ): Promise<NoteWriteManifest> {
    const receipt = preview.indexedWrite && this.indexedOperations
      ? await this.indexedOperations.localLedger(preview.indexedWrite.scope, contentKey(preview.post), preview.indexedWrite.folderPath) : undefined;

    return this.plan(preview.post, {
      ...options,
      fetchId: preview.fetchId ?? (preview.demo ? "demo" : undefined)
    }, receipt);
  }

  async save(preview: PreviewResult, manifest: NoteWriteManifest, signal?: AbortSignal, onTransfer?: (progress: SaveTransferProgress) => void): Promise<SaveResult> {
    signal?.throwIfAborted();
    const epoch = this.auth.sessionEpoch();
    return this.requests.runExclusive(`manual-save:${epoch}:${manifest.contentKey}`, () => this.saveManual(preview, manifest, signal, onTransfer));
  }

  private async saveManual(preview: PreviewResult, manifest: NoteWriteManifest, signal?: AbortSignal, onTransfer?: (progress: SaveTransferProgress) => void): Promise<SaveResult> {
    const prepare = async (resolved: NoteWriteManifest) => {
      manifest = resolved;
      const callback = preview.demo || !preview.fetchId ? null : {
        request: {
          fetchId: preview.fetchId,
          runId: `single-save-${this.createId()}`,
          results: [{ contentKey: manifest.contentKey, notePath: manifest.notePath,
            status: "failed" as const, errorCode: "VAULT_WRITE_INTERRUPTED" }]
        },
        idempotencyKey: `single-result-${contentKey(preview.post)}-${manifest.managedDigest}-${this.createId()}`
      };
      const pendingActionId = await this.durableActions.prepareWrite(preview, manifestOptions(manifest), callback?.request, callback?.idempotencyKey);
      return { pendingActionId, callback };
    };
    const persistence: { prepared?: Awaited<ReturnType<typeof prepare>> } = {};
    let write: VaultWriteResult;
    try {
      write = await this.writeLocal(preview, manifest, signal, undefined, onTransfer, async resolved => {
        persistence.prepared = await prepare(resolved);
      });
    } catch (error) {
      if (persistence.prepared) {
        if (signal?.aborted) await this.durableActions.removeWrites([persistence.prepared.pendingActionId]);
        else await this.durableActions.markWriteFailed(persistence.prepared.pendingActionId, preview, manifest);
      }
      throw error;
    }
    const { pendingActionId, callback } = persistence.prepared!;
    if (!callback) {
      await this.durableActions.removeWrites([pendingActionId]);
      return { write, callback: "not_required" };
    }

    const request = { ...callback.request, results: [writeResult(write)] };
    await this.durableActions.queueCallback(request, callback.idempotencyKey, [pendingActionId]);
    if (signal?.aborted) return { write, callback: "pending" };
    const token = await this.auth.accessToken();
    if (!token) return { write, callback: "pending" };
    try {
      await withTimeout(this.api.writeResults(token, request, callback.idempotencyKey), 45_000);
      await this.durableActions.clearCallback(callback.idempotencyKey);
      return { write, callback: "acknowledged" };
    } catch {
      return { write, callback: "pending" };
    }
  }

  async saveMany(
    previews: readonly PreviewResult[],
    options: WriteOptions = {}
): Promise<BatchSaveResult> {
    const successes: SaveResult[] = [];
    const failures: Array<{ preview: PreviewResult; error: string }> = [];
    for (const preview of previews) {
      try {
        const manifest = await this.planPreview(preview, options);
        successes.push(await this.save(preview, manifest));
      } catch (error) {
        failures.push({
          preview,
          error: error instanceof Error ? error.message : "Vault write failed."
        });
      }
    }
    return { successes, failures };
  }

  async savePrepared(
    prepared: readonly PreparedSave[],
    onProgress?: ((contentKey: string, status: string) => void),
    options?: ManualSaveOptions
): Promise<BatchSaveResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) abort();
    this.manualSaves.add(controller);
    try {
    const successes: SaveResult[] = [];
    const failures: Array<{ preview: PreviewResult; error: string }> = [];
    await parallelBySize(prepared, async entry => {
      const key = contentKey(entry.preview.post);
      try {
        controller.signal.throwIfAborted();
        onProgress?.(key, `Writing note · ${entry.manifest.attachments.length} attachment(s) planned`);
        const saved = await this.save(entry.preview, entry.manifest, controller.signal, options?.onTransfer);
        successes.push(saved);
        const savedAttachments = saved.write.attachments.filter((item) => item.status === "saved").length;
        const failedAttachments = saved.write.attachments.filter((item) => item.status === "failed").length;
        onProgress?.(key, `${saved.write.ledger.completion === "partial" ? "partial" : saved.write.ledger.status} · ${savedAttachments} attachment(s) saved${failedAttachments ? ` · ${failedAttachments} failed` : ""}`);
      } catch (error) {
        const errorMessage = controller.signal.aborted ? "Save cancelled." : error instanceof Error ? error.message : "Vault write failed.";
        failures.push({ preview: entry.preview, error: errorMessage });
        onProgress?.(key, `failed · ${errorMessage}`);
      }
    }, entry => {
      const downloads = entry.preview.post.media.filter(item => entry.manifest.attachments.some(attachment => attachment.mediaId === item.id && attachment.action === "new"));
      return downloads.length === 0 ? 1 : downloads.some(item => item.sizeBytes === undefined) ? undefined : Math.max(...downloads.map(item => item.sizeBytes!));
    });
    return { successes, failures };
    } finally { options?.signal?.removeEventListener("abort", abort); this.manualSaves.delete(controller); }
  }

  runScheduled(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    requireFullRelease();
    return this.runScheduledWithConfiguration(reason);
  }

  private async runScheduledWithConfiguration(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    if (this.api.followChanges) {
      await this.requests.runExclusive("follow:configuration-sync", async () => {
        const epoch = this.auth.sessionEpoch();
        const token = await this.auth.accessToken();
        if (!token) return;
        const { accountId } = await this.requireSupportedVersion(token);
        if (this.executionTarget) await syncDestinations(this.api, this.stateStore, accountId, token, this.executionTarget,
          async () => this.auth.sessionEpoch() === epoch && await this.auth.accessToken() === token);
        const complete = await new FollowConfigurationSync(this.api, this.stateStore).run(accountId, token,
          async () => this.auth.sessionEpoch() === epoch && await this.auth.accessToken() === token);
        if (!complete) throw new Error("Configuration synchronization is incomplete; resume from the saved boundary.");
      });
    }
    return this.scheduler.runScheduled(reason);
  }

  runCreatorNow(creator: CreatorRecord): Promise<SchedulerRunResult> {
    requireFullRelease();
    return this.scheduler.runCreatorNow(creator);
  }

  importCreatorBaseline(creator: CreatorRecord): Promise<BatchSaveResult> {
    requireFullRelease();
    return this.scheduler.importCreatorBaseline(creator);
  }
  async flushPendingCallbacks(accessToken?: string): Promise<number> {
    if (SINGLE_FETCH_REVIEW) return 0;
    const token = accessToken ?? await this.auth.accessToken();
    if (!token) return 0;
    const indexedCompleted = await this.scheduler.flushIndexedCallbacks();
    const completed = new Set<string>();
    for (const callback of await this.durableActions.pendingCallbacks()) {
      // Old Auto-Fetch callbacks lack account provenance. Retain rather than send
      // them under whichever account happens to be signed in after cutover.
      if (this.indexedOperations && callback.request.creatorId) continue;
      try {
        await this.api.writeResults(token, callback.request, callback.idempotencyKey);
        // Older persisted callbacks predate atomic local statistics. Preserve
        // their recovery behavior without recounting new callbacks on delivery.
        if (!callback.statisticsRecorded) {
          const { creatorId, fetchRunId, fetchId, results } = callback.request;
          const keys = results.filter(item => item.status === "success" || item.status === "partial").map(item => item.contentKey);
          if (creatorId && fetchRunId && fetchId) await this.stateStore.recordCreatorSavedPage(
            creatorId, fetchRunId, fetchId, keys.length, new Date().toISOString(), keys);
        }
        completed.add(callback.id);
      } catch {
        // Keep the callback durable for a later host tick or explicit sync.
      }
    }
    await this.durableActions.removeCallbacks(completed);
    return completed.size + indexedCompleted;
  }

  async flushPendingWrites(accessToken?: string): Promise<number> {
    if (SINGLE_FETCH_REVIEW) return 0;
    const token = accessToken ?? await this.auth.accessToken();
    const completed = new Set<string>();
    for (const pending of await this.durableActions.pendingWrites()) {
      if (this.indexedOperations && (pending.request?.creatorId || pending.preview.monitoringInstanceId)) continue;
      try {
        const related = this.taskIdentity ? (await this.importTaskJournal.list(this.taskIdentity.accountId)).find(item =>
          item.checkpoint.lease.leaseId === pending.request?.fetchRunId && item.notes.some(note => note.key === contentKey(pending.preview.post))) : undefined;
        if (related && (related.phase === "cancelled" || ["checking", "downloading", "saving"].includes(related.phase))) continue;
        const recover = async (task?: ImportTaskContext) => {
        const manifest = await this.planPreview(pending.preview, {
          ...pending.options,
          ...(pending.options.notePath ? { targetNotePath: pending.options.notePath } : {})
        });
        const write = await this.writeLocal({ ...pending.preview,
          monitoringInstanceId: pending.preview.monitoringInstanceId ?? pending.request?.creatorId,
          fetchId: pending.preview.fetchId ?? pending.request?.fetchId,
          fetchRunId: pending.preview.fetchRunId ?? pending.request?.fetchRunId }, manifest, task?.signal, task);

        if (pending.request && pending.idempotencyKey) {
          const request = { ...pending.request, results: [writeResult(write)] };
          await this.durableActions.queueCallback(request, pending.idempotencyKey, [pending.id]);
          if (token) {
            try {
              await this.api.writeResults(token, request, pending.idempotencyKey);
              await this.durableActions.clearCallback(pending.idempotencyKey);
            } catch {
              // The callback was persisted before the request and remains retryable.
            }
          }
        }
        completed.add(pending.id);
        };
        if (related) await this.importTaskJournal.run(related.checkpoint, async task => {
          await recover(task);
          return !(await this.durableActions.schedulerCheckpoints(related.accountId)).some(item => item.id === related.id);
        }, true);
        else await recover();
      } catch {
        // Keep the complete normalized source and write intent for a later active host tick.
      }
    }
    await this.durableActions.removeWrites(completed);
    return completed.size;
  }

  private async writeLocal(
    preview: PreviewResult,
    manifest: NoteWriteManifest,
    signal?: AbortSignal,
    task?: ImportTaskContext,
    onTransfer?: (progress: SaveTransferProgress) => void,
    prepareManualWrite?: (manifest: NoteWriteManifest) => Promise<void>
  ): Promise<VaultWriteResult> {
    if (preview.historyRestore && preview.post.needSupplement === true)
      throw new Error("This saved post is incomplete. History restoration never requests new details.");
    const epoch = this.auth.sessionEpoch();
    const writer = this.vaultWriter;
    return this.requests.runExclusive(
      `vault-write:${epoch}:${manifest.contentKey}:${prepareManualWrite ? "manual" : "background"}`,
      async () => {
        const { installationId } = await this.stateStore.load();
        return hostExecutionLocks.run(["vault-content", installationId, manifest.contentKey], () => {
          signal?.throwIfAborted();
          if (epoch !== this.auth.sessionEpoch() || writer !== this.vaultWriter)
            throw new Error("The account or destination changed before this write could start.");
          const activityScope = preview.indexedWrite
            ? { ...preview.indexedWrite.scope, epoch, folderPath: preview.indexedWrite.folderPath }
            : !this.indexedOperations ? preview.monitoringInstanceId : undefined;
          return activityScope
            ? this.autoActivity.track(activityScope, "importing", () => this.writeLocalOnce(preview, manifest, signal, task, onTransfer, prepareManualWrite))
            : this.writeLocalOnce(preview, manifest, signal, task, onTransfer, prepareManualWrite);
        });
      }
    );

  }

  private async confirmIndexedWrite(preview: PreviewResult, reuse = false): Promise<VaultWriteResult | undefined> {
    const context = preview.indexedWrite, store = this.indexedOperations;
    if (!context || !store || !preview.fetchRunId) return undefined;
    const epoch = this.auth.sessionEpoch(), writer = this.vaultWriter;
    const intent = await store.writeIntent(context.scope, preview.fetchRunId, contentKey(preview.post));
    if (!intent || !intent.manifest.notePath.startsWith(`${context.folderPath.replace(/\/$/, "")}/`)) return undefined;
    const known = await store.writeReceipt(context.scope, preview.fetchRunId, intent.manifest.contentKey, intent.manifest.notePath);
    if (epoch !== this.auth.sessionEpoch() || writer !== this.vaultWriter) return undefined;
    if (known && known.ledger.status !== "failed" && known.ledger.physicalStatus !== "missing"
      && known.ledger.media.every(item => item.status !== "failed")) {
      return { manifest: intent.manifest, file: { path: known.ledger.notePath }, ledger: known.ledger, recovered: known.saved,
        attachments: known.ledger.media.map(item => ({ ...item,
          mediaId: item.mediaKey.slice(`${intent.manifest.contentKey}:media:`.length) })) };
    }
    if (reuse) {
      const ledger = await store.localLedger(context.scope, intent.manifest.contentKey, context.folderPath);
      const write = ledger && await writer.confirmReuse(intent.manifest, ledger);
      if (!write || epoch !== this.auth.sessionEpoch() || writer !== this.vaultWriter) return undefined;
      write.recovered = Boolean(known?.saved);
      await store.commitWrite(context.scope, write, context.request, false);
      return write;
    }
    return hostExecutionLocks.run(["vault-content", context.scope.installationId, intent.manifest.contentKey], async () => {
      const assertCurrent = () => {
        if (epoch !== this.auth.sessionEpoch() || writer !== this.vaultWriter) throw new Error("The account or destination changed during write verification.");
      };
      assertCurrent();
      const recoveryContext = { monitoringInstanceId: preview.monitoringInstanceId, firstWrittenAt: known?.ledger.firstWrittenAt, assertCurrent, recoverUnpreparedNote: intent.notePrepared === false };
      const write = await writer.confirmRecovery(intent.recoveryId, intent.manifest, preview.post.canonicalUrl, recoveryContext)
        ?? await writer.reconcilePublications(intent.recoveryId, intent.manifest, Object.values(intent.mediaPublications ?? {}), preview.post.canonicalUrl, recoveryContext);
      if (!write) return undefined;
      assertCurrent();
      await store.commitWrite(context.scope, write, context.request, true);
      return write;
    });
  }

  private async writeLocalOnce(
    preview: PreviewResult,
    manifest: NoteWriteManifest,
    signal?: AbortSignal,
    task?: ImportTaskContext,
    onTransfer?: (progress: SaveTransferProgress) => void,
    prepareManualWrite?: (manifest: NoteWriteManifest) => Promise<void>
): Promise<VaultWriteResult> {
    if (task) await this.importTaskJournal.beginNote(task, preview, manifest);
    try {
    const media = new Map(preview.post.media.map((item) => [item.id, item]));
    const writer = this.vaultWriter, epoch = this.auth.sessionEpoch();
    const indexedContext = preview.indexedWrite;
    const autoFetch = Boolean(indexedContext || preview.monitoringInstanceId);
    const prior = indexedContext && this.indexedOperations
      ? await this.indexedOperations.localLedger(indexedContext.scope, manifest.contentKey, indexedContext.folderPath)
      : (await this.stateStore.load()).ledger[manifest.contentKey];
    const intent = indexedContext && this.indexedOperations && preview.fetchRunId
      ? await this.indexedOperations.prepareWrite(indexedContext.scope, preview.fetchRunId, manifest) : undefined;
    const recovery = intent ? await writer.recoveryEvidence(intent.recoveryId, intent.manifest) : undefined;
    const alreadySavedByRun = indexedContext && this.indexedOperations && preview.fetchRunId
      ? await this.indexedOperations.hasSavedReceipt(indexedContext.scope, preview.fetchRunId, manifest.contentKey, manifest.notePath) : false;
    if (epoch !== this.auth.sessionEpoch() || writer !== this.vaultWriter)
      throw new Error("The account or destination changed before this write could start.");
    let plannedDownloads = manifest.attachments.filter(attachment => attachment.action === "new");
    const downloadedMedia = new Set<string>();
    const activeTransfers = new Map<string, { receivedBytes: number; totalBytes?: number | undefined }>();
    const emitTransfer = (mediaId: string, progress: { receivedBytes: number; totalBytes?: number | undefined }, downloading: boolean) => {
      if (signal?.aborted) return;
      if (downloading) activeTransfers.set(mediaId, progress); else activeTransfers.delete(mediaId);
      const [activeId, current] = [...activeTransfers].at(-1) ?? [mediaId, progress];
      onTransfer?.({ ...current, contentKey: manifest.contentKey,
        attachmentIndex: plannedDownloads.findIndex(attachment => attachment.mediaId === activeId) + 1,
        attachmentCount: plannedDownloads.length, downloadedCount: downloadedMedia.size, downloading: activeTransfers.size > 0 });
    };
    const baseWrite = await writer.execute(
      manifest,
      preview.post.canonicalUrl,
      this.mediaDownloader
        ? async (mediaId, lease) => {
            const deferred = preview.deferredMedia?.find(item => item.mediaId === mediaId);
            if (deferred) throw new MediaDownloadError(deferred.kind,
              "This attachment is waiting for its next eligible recovery attempt.", undefined, true);
            const item = media.get(mediaId);
            if (!item) throw new Error("Media item is missing from the preview.");
            if ((preview.historyRestore || this.mediaDownloader?.refreshOnFailure === false) && item.downloadUrlExpiresAt
                && Date.parse(item.downloadUrlExpiresAt) <= Date.now())
              throw new MediaDownloadError("source_expired", "Media download link expired. Waiting for a normal check to retrieve a new link.");
            const reportTransfer = (progress: { receivedBytes: number; totalBytes?: number | undefined }, downloading = true) => emitTransfer(mediaId, progress, downloading);
            const finishTransfer = (downloaded: Awaited<ReturnType<MediaDownloaderPort["download"]>>) => {
              downloadedMedia.add(mediaId);
              const size = "kind" in downloaded ? downloaded.sizeBytes : downloaded.byteLength;
              reportTransfer({ receivedBytes: size, totalBytes: size }, false);
              return downloaded;
            };
            reportTransfer({ receivedBytes: 0 });
            try {
              const downloaded = await this.mediaDownloader!.download(item, signal, progress => {
                reportTransfer(progress);
                if (task) this.importTaskJournal.progress(task, manifest.contentKey, mediaId, progress, "downloading");
              }, lease);
              if (task) this.importTaskJournal.progress(task, manifest.contentKey, mediaId, {
                receivedBytes: "kind" in downloaded ? downloaded.sizeBytes : downloaded.byteLength,
                totalBytes: "kind" in downloaded ? downloaded.sizeBytes : downloaded.byteLength
              }, "saving");
              return finishTransfer(downloaded);
            } catch (initialError) {
              signal?.throwIfAborted();
              // WRITE-003 retains the mobile refresh policy; desktop follows WRITE-001.
              if (preview.historyRestore || this.mediaDownloader?.refreshOnFailure === false || initialError instanceof MediaRecoveryError) throw initialError;
              const token = await this.auth.accessToken();
              if (!token || preview.demo) throw initialError;
              const refreshed = await this.api.refreshMedia(
                token,
                preview.post.contentId,
                [mediaId],
                `media-refresh-${contentKey(preview.post)}-${mediaId}`
);
              const replacement = refreshed.find((candidate) => candidate.id === mediaId);
              if (!replacement) throw initialError;
              const downloaded = await this.mediaDownloader!.download(replacement, signal, progress => { reportTransfer(progress); if (task) this.importTaskJournal.progress(task, manifest.contentKey, mediaId, progress, "downloading"); }, lease);
              return finishTransfer(downloaded);
            }
          }
        : undefined,
      {
        signal,
        mediaSize: id => media.get(id)?.sizeBytes,
        bufferedDownloads: this.mediaDownloader?.streaming === false,
        waitForTransferSlot: this.mediaDownloader?.waitForTransferSlot,
        physicalWrite: async work => hostExecutionLocks.run(["vault-write", (await this.stateStore.load()).installationId], work),
        prepareNote: prepareManualWrite ? async () => {
          if (epoch !== this.auth.sessionEpoch() || writer !== this.vaultWriter)
            throw new Error("The account or destination changed before this write could start.");
          // Resolve the final path and persist its intent under the same lock as note creation.
          if (!intent) {
            manifest = await writer.resolveNewCollision(preview.post, manifest);
            plannedDownloads = manifest.attachments.filter(attachment => attachment.action === "new");
          }
          await prepareManualWrite(manifest);
          return manifest;
        } : undefined,
        onAttachment: task || onTransfer ? async result => {
          if (activeTransfers.has(result.mediaId)) emitTransfer(result.mediaId, { receivedBytes: 0 }, false);
          if (task) await this.importTaskJournal.attachment(task, manifest.contentKey, result);
        } : undefined,
        actionId: intent?.recoveryId ?? this.createId(),
        recoveryId: intent?.recoveryId,
        assertCurrent: autoFetch ? () => {
          if (epoch !== this.auth.sessionEpoch() || writer !== this.vaultWriter)
            throw new Error("The account or destination changed during this write.");
        } : undefined,
        notePrepared: intent && indexedContext && this.indexedOperations && preview.fetchRunId
          ? () => this.indexedOperations!.markNotePrepared(indexedContext.scope, preview.fetchRunId!,
            manifest.contentKey, manifest.notePath, intent.recoveryId) : undefined,
        prepareMediaPublication: intent && indexedContext && this.indexedOperations && preview.fetchRunId
          ? evidence => this.indexedOperations!.prepareMediaPublication(indexedContext.scope, preview.fetchRunId!,
            manifest.contentKey, manifest.notePath, intent.recoveryId, evidence) : undefined,

        monitoringInstanceId: preview.monitoringInstanceId,
        firstWrittenAt: prior?.firstWrittenAt ?? prior?.writtenAt
      }
);
    const write: VaultWriteResult = {
      ...baseWrite,
      ...(recovery || alreadySavedByRun ? { recovered: true } : {}),
      ledger: {
        ...baseWrite.ledger,
        ...(recovery?.savedAt && manifest.action === "skip" && !baseWrite.attachments.some(item => item.status === "saved")
          ? { writtenAt: recovery.savedAt } : {}),
        ...(preview.fetchId ? { fetchId: preview.fetchId } : {})
      }
    };
    const newSave = Boolean(recovery) || write.manifest.action !== "skip" || write.attachments.some(item => item.status === "saved");
    if (indexedContext && this.indexedOperations) {
      try { await this.indexedOperations.commitWrite(indexedContext.scope, write, indexedContext.request, newSave); }
      catch (error) {
        throw new AgentLensError("vault_write_failed", "Saved files need verification before retrying.", false,
          undefined, { cause: error }, undefined, undefined, "WRITE_REQUIRES_RECONCILIATION");
      }
      // The JSON ledger is a legacy cache, not the authority for indexed writes.
      try { await this.stateStore.update(state => { state.ledger[write.ledger.contentKey] = write.ledger; }); }
      catch { /* The canonical receipt, statistics and callback are already committed together. */ }
    } else {
      await this.stateStore.update((state) => {
        state.ledger[write.ledger.contentKey] = write.ledger;
        if (preview.monitoringInstanceId && preview.fetchRunId && preview.fetchId && newSave) {
          recordCreatorSavedPageInState(state, preview.monitoringInstanceId, preview.fetchRunId,
            preview.fetchId, 1, write.ledger.writtenAt, [write.ledger.contentKey], preview.fetchRunSequence);
        }
      });
    }
    if (task) await this.importTaskJournal.endNote(task, manifest.contentKey, write);

    return write;
    } catch (error) {
      if (task) await this.importTaskJournal.endNote(task, manifest.contentKey, undefined, error);
      throw error;
    }
  }

  private async requireAccessToken(): Promise<string> {
    const token = await this.auth.accessToken();
    if (!token) throw new Error("Sign in to AgentLens first.");
    return token;
  }

  private async requireSupportedVersion(accessToken: string): Promise<AccountCapabilities> {
    const capabilities = await this.api.capabilities(accessToken);
    if (compareVersions(this.api.currentClientVersion(), capabilities.minimumPluginVersion) < 0) {
      throw new Error(
        `AgentLens ${capabilities.minimumPluginVersion} or newer is required. Update in Obsidian Community Plugins before using live actions.`
);
    }
    this.taskIdentity = { token: accessToken, accountId: capabilities.accountId };
    return capabilities;
  }

}

function manifestOptions(manifest: NoteWriteManifest): {
  folderPath: string;
  templateId: "default" | "compact";
  mediaPolicy: MediaPolicy;
  notePath: string;
  saveAsCopy?: boolean;
} {
  return {
    folderPath: manifest.notePath.slice(0, manifest.notePath.lastIndexOf("/")),
    templateId: manifest.templateId,
    mediaPolicy: manifest.mediaPolicy,
    notePath: manifest.notePath,
    ...(manifest.saveAsCopy ? { saveAsCopy: true } : {})
  };
}

function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Result confirmation timed out.")), milliseconds);
    operation.then(
      value => { window.clearTimeout(timer); resolve(value); },
      error => { window.clearTimeout(timer); reject(error instanceof Error ? error : new Error("Result confirmation failed.")); }
);
  });
}
