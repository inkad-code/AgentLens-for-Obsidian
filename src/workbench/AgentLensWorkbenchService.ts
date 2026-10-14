import { SINGLE_DEMO_LINK, BULK_DEMO_LINK } from "../core/demoLinks";
import { SINGLE_FETCH_REVIEW, requireFullRelease } from "../core/releaseProfile";
import { publicLinkFromText } from "../core/urls";
import type { AutoFetchCapabilities, AccountSummary, ActivityDetail, ActivityExport, ActivityFilters, ActivityPage, CreatorParseResult, CreatorRecord, CreatorSchedulePreview, CreatorSettingsInput, FetchPage, SchedulerReconcileReason } from "../api/AgentLensApiClient";
import type { AuthState } from "../auth/AuthService";
import { AuthService } from "../auth/AuthService";
import type { MediaPolicy, NormalizedPost } from "../core/domain";
import { contentKey } from "../core/domain";
import { PluginStateStore, type PluginUiPreferences } from "../runtime/PluginStateStore";
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
    checkout: async id => (await this.billingApi()).checkout(id),
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

  private readonly durableActions: DurableActionStore;
  private readonly scheduler: SchedulerCoordinator;

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
    private readonly requests: RequestCoordinator = new RequestCoordinator()
) {
    this.durableActions = new DurableActionStore(stateStore, createId);
    this.scheduler = new SchedulerCoordinator(auth, api, this.durableActions, requests, createId, {
      requireSupportedVersion: (accessToken) => this.requireSupportedVersion(accessToken),
      flushPendingWrites: (accessToken) => this.flushPendingWrites(accessToken),
      flushPendingCallbacks: (accessToken) => this.flushPendingCallbacks(accessToken),
      saveMany: (previews, options) => this.saveMany(previews, options),
      planPreview: (preview, options) => this.planPreview(preview, options),
      writeLocal: (preview, manifest) => this.writeLocal(preview, manifest),
      recordCreatorSavedPage: (creatorId, fetchRunId, fetchId, savedContentKeys) => this.stateStore.recordCreatorSavedPage(
        creatorId,
        fetchRunId,
        fetchId,
        savedContentKeys.length,
        new Date().toISOString(),
        savedContentKeys
)
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

  restoreAuth(): Promise<AuthState> {
    return this.auth.restore();
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
    return this.api.account(token);
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
    const [settings, creators, autoFetchCapabilities] = await Promise.all([
      this.api.settings(token),
      this.api.listCreators(token),
      this.api.autoFetchCapabilities(token)
    ]);
    return { settings, autoFetchCapabilities, creators: await this.stateStore.mergeCreatorDiagnostics(creators) };
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
    return this.durableActions.runRemoteAction(
      remoteScope("creator-create", JSON.stringify(input)),
      "creator-create",
      ({ idempotencyKey }) => this.api.createCreator(token, input, idempotencyKey)
);
  }

  async setCreatorEnabled(creatorId: string, enabled: boolean): Promise<CreatorRecord> {
    requireFullRelease();
    const token = await this.requireAccessToken();
    await this.requireSupportedVersion(token);
    return this.durableActions.runRemoteAction(
      remoteScope("creator-toggle", `${creatorId}:${enabled}`),
      "creator-toggle",
      ({ idempotencyKey }) => this.api.updateCreator(token, creatorId, enabled, idempotencyKey)
);
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
    return this.requests.runExclusive(`single-fetch:${url}`, () => this.previewSingleOnce(url));
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

  async fetchProfilePage(url: string, cursor: string | null): Promise<FetchPage> {
    url = publicLinkFromText(url);
    return this.requests.runExclusive(
      `profile-fetch:${url}:${cursor ?? "first"}`,
      () => this.fetchProfilePageOnce(url, cursor)
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
    options: WriteOptions & { fetchId?: string | undefined; fetchedAt?: string | undefined } = {}
): Promise<NoteWriteManifest> {
    const writer = this.createVaultWriter && (options.folderPath || options.mediaPolicy || options.templateId)
      ? this.createVaultWriter(options)
      : this.vaultWriter;
    const previous = (await this.stateStore.load()).ledger[contentKey(post)];
    const folder = options.folderPath?.replace(/\/$/, "");
    const sameDestination = previous && (!folder || previous.notePath.startsWith(`${folder}/`));
    const existingMediaPaths = sameDestination && !options.saveAsCopy ? Object.fromEntries((previous.media ?? [])
      .filter(item => item.status === "saved" || item.status === "skipped")
      .map(item => [item.mediaKey.slice(`${contentKey(post)}:media:`.length), item.path])) : {};
    return writer.plan(post, { fetchId: options.fetchId, fetchedAt: options.fetchedAt, existingMediaPaths,
      existingMediaNotePath: sameDestination ? previous.notePath : undefined,
      saveAsCopy: options.saveAsCopy, targetNotePath: options.targetNotePath });
  }

  planPreview(
    preview: PreviewResult,
    options: WriteOptions = {}
): Promise<NoteWriteManifest> {
    return this.plan(preview.post, {
      ...options,
      fetchId: preview.fetchId ?? (preview.demo ? "demo" : undefined)
    });
  }

  async save(preview: PreviewResult, manifest: NoteWriteManifest, signal?: AbortSignal): Promise<SaveResult> {
    signal?.throwIfAborted();
    manifest = await this.vaultWriter.resolveNewCollision(preview.post, manifest);
    signal?.throwIfAborted();
    const callback = preview.demo || !preview.fetchId ? null : {
      request: {
        fetchId: preview.fetchId,
        runId: `single-save-${this.createId()}`,
        results: [{
          contentKey: manifest.contentKey,
          notePath: manifest.notePath,
          status: "failed" as const,
          errorCode: "VAULT_WRITE_INTERRUPTED"
        }]
      },
      idempotencyKey: `single-result-${contentKey(preview.post)}-${manifest.managedDigest}-${this.createId()}`
    };
    const pendingActionId = await this.durableActions.prepareWrite(
      preview,
      manifestOptions(manifest),
      callback?.request,
      callback?.idempotencyKey
);
    let write: VaultWriteResult;
    try {
      write = await this.writeLocal(preview, manifest, signal);
    } catch (error) {
      if (signal?.aborted) await this.durableActions.removeWrites([pendingActionId]);
      else await this.durableActions.markWriteFailed(pendingActionId, preview, manifest);
      throw error;
    }
    if (!callback) {
      await this.durableActions.removeWrites([pendingActionId]);
      return { write, callback: "not_required" };
    }

    const request = { ...callback.request, results: [writeResult(write)] };
    await this.durableActions.queueCallback(request, callback.idempotencyKey, [pendingActionId]);
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
    onProgress?: ((contentKey: string, status: string) => void)
): Promise<BatchSaveResult> {
    const controller = new AbortController();
    this.manualSaves.add(controller);
    try {
    const successes: SaveResult[] = [];
    const failures: Array<{ preview: PreviewResult; error: string }> = [];
    for (const entry of prepared) {
      const key = contentKey(entry.preview.post);
      try {
        controller.signal.throwIfAborted();
        onProgress?.(key, `Writing note · ${entry.manifest.attachments.length} attachment(s) planned`);
        const saved = await this.save(entry.preview, entry.manifest, controller.signal);
        successes.push(saved);
        const savedAttachments = saved.write.attachments.filter((item) => item.status === "saved").length;
        const failedAttachments = saved.write.attachments.filter((item) => item.status === "failed").length;
        onProgress?.(key, `${saved.write.ledger.completion === "partial" ? "partial" : saved.write.ledger.status} · ${savedAttachments} attachment(s) saved${failedAttachments ? ` · ${failedAttachments} failed` : ""}`);
      } catch (error) {
        const errorMessage = controller.signal.aborted ? "Save cancelled." : error instanceof Error ? error.message : "Vault write failed.";
        failures.push({ preview: entry.preview, error: errorMessage });
        onProgress?.(key, `failed · ${errorMessage}`);
      }
    }
    return { successes, failures };
    } finally { this.manualSaves.delete(controller); }
  }

  runScheduled(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    requireFullRelease();
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
    const completed = new Set<string>();
    for (const callback of await this.durableActions.pendingCallbacks()) {
      try {
        await this.api.writeResults(token, callback.request, callback.idempotencyKey);
        await this.recordRecoveredSave(callback.request);
        completed.add(callback.id);
      } catch {
        // Keep the callback durable for a later host tick or explicit sync.
      }
    }
    await this.durableActions.removeCallbacks(completed);
    return completed.size;
  }

  private async recordRecoveredSave(request: Parameters<AgentLensApiPort["writeResults"]>[1]): Promise<void> {
    const { creatorId, fetchRunId, fetchId, results } = request;
    if (!creatorId || !fetchRunId || !fetchId) return;
    const keys = results.filter((result) => result.status !== "failed").map((result) => result.contentKey);
    await this.stateStore.recordCreatorSavedPage(creatorId, fetchRunId, fetchId,
      keys.length, new Date().toISOString(), keys);
  }

  async flushPendingWrites(accessToken?: string): Promise<number> {
    if (SINGLE_FETCH_REVIEW) return 0;
    const token = accessToken ?? await this.auth.accessToken();
    const completed = new Set<string>();
    for (const pending of await this.durableActions.pendingWrites()) {
      try {
        const manifest = await this.planPreview(pending.preview, {
          ...pending.options,
          ...(pending.options.notePath ? { targetNotePath: pending.options.notePath } : {})
        });
        const write = await this.writeLocal(pending.preview, manifest);
        if (pending.request && pending.idempotencyKey) {
          const request = { ...pending.request, results: [writeResult(write)] };
          await this.durableActions.queueCallback(request, pending.idempotencyKey, [pending.id]);
          if (token) {
            try {
              await this.api.writeResults(token, request, pending.idempotencyKey);
              await this.recordRecoveredSave(request);
              await this.durableActions.clearCallback(pending.idempotencyKey);
            } catch {
              // The callback was persisted before the request and remains retryable.
            }
          }
        }
        completed.add(pending.id);
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
    signal?: AbortSignal
): Promise<VaultWriteResult> {
    return this.requests.runExclusive(
      `vault-write:${manifest.contentKey}`,
      () => this.writeLocalOnce(preview, manifest, signal)
);
  }

  private async writeLocalOnce(
    preview: PreviewResult,
    manifest: NoteWriteManifest,
    signal?: AbortSignal
): Promise<VaultWriteResult> {
    const media = new Map(preview.post.media.map((item) => [item.id, item]));
    const prior = (await this.stateStore.load()).ledger[manifest.contentKey];
    const baseWrite = await this.vaultWriter.execute(
      manifest,
      preview.post.canonicalUrl,
      this.mediaDownloader
        ? async (mediaId) => {
            const item = media.get(mediaId);
            if (!item) throw new Error("Media item is missing from the preview.");
            try {
              return await this.mediaDownloader!.download(item, signal);
            } catch (initialError) {
              signal?.throwIfAborted();
              // Desktop follows Eagle WRITE-001: retain failed media for a later source fetch.
              // Keep the existing mobile recovery behavior until its separate migration.
              if (this.mediaDownloader?.refreshOnFailure === false) throw initialError;
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
              return this.mediaDownloader!.download(replacement, signal);
            }
          }
        : undefined,
      {
        signal,
        actionId: this.createId(),
        monitoringInstanceId: preview.monitoringInstanceId,
        firstWrittenAt: prior?.firstWrittenAt ?? prior?.writtenAt
      }
);
    const write: VaultWriteResult = {
      ...baseWrite,
      ledger: {
        ...baseWrite.ledger,
        ...(preview.fetchId ? { fetchId: preview.fetchId } : {})
      }
    };
    await this.stateStore.update((state) => {
      state.ledger[write.ledger.contentKey] = write.ledger;
    });
    return write;
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
