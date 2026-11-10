import type { ImportTasks, ImportTaskContext } from "./ImportTasks";
import { MediaWriteUncertainError } from "../core/mediaFailure";
import { CallbackDispatcher } from "../auto-fetch/callback-dispatcher";
import { IndexedScheduler, type SchedulerSession } from "../auto-fetch/indexed-scheduler";
import type { OperationStore, OperationScope } from "../auto-fetch/operation-store";
import { AutoFetchActivityTracker } from "./AutoFetchActivity";

import type {
  CreatorRecord,
  CreatorUpdatePage,
  SchedulerLease,
  SchedulerReconcileReason,
  WriteResultInput
} from "../api/AgentLensApiClient";
import type { AccountCapabilities } from "../api/contracts";
import type { AuthService } from "../auth/AuthService";
import { AgentLensError } from "../core/errors";
import type { RequestCoordinator } from "../runtime/RequestCoordinator";
import type { NoteWriteManifest, VaultWriteResult } from "../vault/VaultWriter";
import type { AgentLensApiPort } from "./ports";
import type { DurableActionStore, SchedulerCheckpoint, SchedulerDelivery } from "./DurableActionStore";
import type { BatchSaveResult, PreviewResult, SchedulerRunResult, WriteOptions } from "./types";
import { remoteScope } from "./identifiers";
import { autoWriteRequest, writeResult } from "./writeResults";
import { contentKey } from "../core/domain";

interface SchedulerOperations {
  requireSupportedVersion(accessToken: string): Promise<AccountCapabilities>;
  flushPendingWrites(accessToken?: string): Promise<number>;
  flushPendingCallbacks(accessToken?: string): Promise<number>;
  saveMany(previews: readonly PreviewResult[], options: WriteOptions): Promise<BatchSaveResult>;
  planPreview(preview: PreviewResult, options: WriteOptions): Promise<NoteWriteManifest>;
  writeLocal(preview: PreviewResult, manifest: NoteWriteManifest, task?: ImportTaskContext): Promise<VaultWriteResult>;
  confirmIndexedWrite?(preview: PreviewResult, reuse?: boolean): Promise<VaultWriteResult | undefined>;

}

export class SchedulerCoordinator {
  private nextAutomaticLane = 0;
  private readonly indexed: IndexedScheduler | undefined;
  private readonly callbacks: CallbackDispatcher | undefined;
  constructor(
    private readonly auth: AuthService,
    private readonly api: AgentLensApiPort,
    private readonly durableActions: DurableActionStore,
    private readonly requests: RequestCoordinator,
    private readonly createId: () => string,
    private readonly operations: SchedulerOperations,
    private readonly activity = new AutoFetchActivityTracker(),
    private readonly indexedContext?: { store: OperationStore; session(): Promise<SchedulerSession | undefined>;
      sharedDestinationReady?(session: SchedulerSession, creator: import("../api/AgentLensApiClient").CreatorRecord): Promise<boolean>;
  destinationAvailable?(session: SchedulerSession, operation: import("../auto-fetch/operation-store").SourceOperation): Promise<boolean>;
  configurationReady?(session: SchedulerSession, followId: string | undefined): Promise<boolean>; },
    private readonly importTasks?: ImportTasks
  ) {
    if (indexedContext) {
      this.callbacks = new CallbackDispatcher({ ...indexedContext, api, requests, now: () => Date.now() });
      this.indexed = new IndexedScheduler({ ...indexedContext, api, requests, createId, now: () => new Date(),
      source: (_creatorId, task, scope) => activity.track(scope, "parsing", task),
      deliver: (token, page, lease, sequence, attempt, confirmOnly) => this.saveAutoPage(token, page, lease, `indexed_scheduler:${attempt}${confirmOnly === "reuse" ? ":reuse" : ""}`, sequence, confirmOnly) });
    }
  }

  flushIndexedCallbacks(): Promise<number> {
    return this.callbacks?.flush() ?? Promise.resolve(0);
  }

  registerNewCreator(creator: CreatorRecord, startedAt: string): Promise<void> {
    return this.indexed?.register(creator, startedAt) ?? Promise.resolve();
  }


  runScheduled(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    if (this.indexed) return this.runIndexed(reason);
    return this.requests.runExclusive("scheduler:pass", () => this.runScheduledOnce(reason));
  }

  runCreatorNow(creator: CreatorRecord): Promise<SchedulerRunResult> {
    return this.requests.runExclusive(
      `scheduler:manual:${creator.creatorId}`,
      () => this.indexed ? this.indexed.manual(creator) : this.runCreatorNowOnce(creator)
    );

  }

  retryCreator(creator: CreatorRecord): Promise<SchedulerRunResult> {
    if (this.indexed) return this.runCreatorNow(creator);
    return this.requests.runExclusive(
      `scheduler:retry:${creator.creatorId}`,
      () => this.retryCreatorOnce(creator)
);
  }

  importCreatorBaseline(creator: CreatorRecord): Promise<BatchSaveResult> {
    return this.requests.runExclusive(`scheduler:baseline:${creator.creatorId}`, () => this.importCreatorBaselineOnce(creator));
  }

  private async importCreatorBaselineOnce(creator: CreatorRecord): Promise<BatchSaveResult> {
    const token = await this.requireAccessToken();
    await this.operations.requireSupportedVersion(token);
    const action = await this.durableActions.getOrCreateRemoteAction(
      remoteScope("creator-baseline", creator.creatorId),
      "creator-baseline"
);
    try {
      const page = await this.api.baselineImport(token, creator.creatorId, action.requestId, action.idempotencyKey);
      const result = await this.operations.saveMany(
        page.content.map((post) => ({ post, fetchId: page.fetchId, demo: false })),
        { folderPath: creator.saveFolderPath, templateId: creator.noteTemplateId, mediaPolicy: creator.mediaPolicy }
);
      if (result.failures.length === 0) await this.durableActions.remove([action.id]);
      return result;
    } catch (error) {
      if (error instanceof AgentLensError && !error.retryable) await this.durableActions.remove([action.id]);
      throw error;
    }
  }

  private async runIndexed(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    const replay = this.flushIndexedCallbacks();
    void replay.catch(() => undefined);
    try {
      const result = await this.indexed!.run(reason);
      if (result.skipped) return result;
      const token = await this.requireAccessToken();
      const { accountId } = await this.operations.requireSupportedVersion(token);
      // Recover existing legacy identities without admitting new legacy leases.
      await this.requests.runExclusive("scheduler:legacy-recovery", async () => {
        for (const checkpoint of await this.durableActions.schedulerCheckpoints(accountId))
          await this.runCheckpoint(token, checkpoint, reason, result);
        for (const delivery of await this.durableActions.schedulerDeliveries(accountId))
          this.addSettled(result, await this.deliverPage(token, delivery));
        await this.operations.flushPendingWrites(token);
        await this.operations.flushPendingCallbacks(token);
      });
      return result;
    } finally { await replay; }
  }

  private async runScheduledOnce(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    const token = await this.auth.accessToken();
    if (!token) return { leases: 0, pages: 0, saved: 0, failed: 0, skipped: "signed_out" };
    const { accountId } = await this.operations.requireSupportedVersion(token);
    const reconciled = await this.requests.runExclusive("scheduler:reconcile", () => this.durableActions.runRemoteAction(
      remoteScope("scheduler-reconcile", reason),
      "scheduler-reconcile",
      ({ requestId, idempotencyKey }) => this.api.reconcile(token, reason, requestId, idempotencyKey)
    ));

    // Persist every admitted lease before running any of them. A failure in one
    // creator must not discard another creator's original target snapshot.
    for (const lease of reconciled.leases) await this.durableActions.prepareSchedulerCheckpoint(accountId, lease);
    const pending = await this.durableActions.schedulerCheckpoints(accountId);
    const result: SchedulerRunResult = { leases: pending.length, pages: 0, saved: 0, failed: 0, skipped: null };
    const recovery = this.requests.runExclusive("scheduler:delivery-recovery", async () => {
      for (const delivery of await this.durableActions.schedulerDeliveries(accountId))
        this.addSettled(result, await this.deliverPage(token, delivery));
      await this.operations.flushPendingWrites(token);
      await this.operations.flushPendingCallbacks(token);
    });
    // Existing admitted source pages can run while old Vault deliveries recover.
    void recovery.catch(() => undefined);
    const work = await Promise.allSettled(pending.map(checkpoint => this.runCheckpoint(token, checkpoint, reason, result)));
    await recovery;
    const failed = work.find(item => item.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;

    return result;
  }

  private async runCreatorNowOnce(creator: CreatorRecord): Promise<SchedulerRunResult> {
    this.requireOnline();

    const token = await this.requireAccessToken();
    const { accountId } = await this.operations.requireSupportedVersion(token);
    const lease: SchedulerLease = {
      creatorId: creator.creatorId,
      leaseId: `manual-${this.createId()}`,
      trigger: "manual_check",
      saveFolderPath: creator.saveFolderPath,
      noteTemplateId: creator.noteTemplateId,
      mediaPolicy: creator.mediaPolicy,
      schedulerState: creator.schedulerState,
      nextCheckAt: creator.nextCheckAt
    };
    const checkpoint = await this.durableActions.prepareSchedulerCheckpoint(accountId, lease);
    const result: SchedulerRunResult = { leases: 1, pages: 0, saved: 0, failed: 0, skipped: null };
    await this.runCheckpoint(token, checkpoint, "manual_check", result);
    return result;
  }

  private async retryCreatorOnce(creator: CreatorRecord): Promise<SchedulerRunResult> {
    const token = await this.requireAccessToken();
    const { accountId } = await this.operations.requireSupportedVersion(token);
    await this.operations.flushPendingWrites(token);
    await this.operations.flushPendingCallbacks(token);
    const latest = (await this.api.listCreators(token)).find((item) => item.creatorId === creator.creatorId) ?? creator;
    if (latest.schedulerState !== "retry_pending" || !latest.activeJobId) {
      return { leases: 0, pages: 0, saved: 0, failed: 0, skipped: null };
    }
    const lease: SchedulerLease = {
      creatorId: latest.creatorId,
      leaseId: latest.activeJobId,
      trigger: "retry",
      saveFolderPath: latest.saveFolderPath,
      noteTemplateId: latest.noteTemplateId,
      mediaPolicy: latest.mediaPolicy,
      schedulerState: latest.schedulerState,
      nextCheckAt: latest.nextCheckAt
    };
    const result: SchedulerRunResult = { leases: 1, pages: 0, saved: 0, failed: 0, skipped: null };
    const checkpoint = await this.durableActions.prepareSchedulerCheckpoint(accountId, lease);
    await this.runCheckpoint(token, checkpoint, "retry", result);
    return result;
  }

  async retryTask(id: string): Promise<void> {
    const token = await this.requireAccessToken();
    const { accountId } = await this.operations.requireSupportedVersion(token);
    const checkpoint = (await this.durableActions.schedulerCheckpoints(accountId)).find(item => item.id === id);
    if (!checkpoint) throw new Error("The source run has ended. Only failed local note attachments can be retried.");
    await this.runCheckpoint(token, checkpoint, "retry", { leases: 1, pages: 0, saved: 0, failed: 0, skipped: null }, true);
  }

  private async runCheckpoint(token: string, checkpoint: SchedulerCheckpoint, reason: string,
    result: SchedulerRunResult, explicit = false): Promise<void> {
    const work = async (task?: ImportTaskContext): Promise<boolean | "failed"> => {
    const deliveries: Promise<BatchSaveResult>[] = [];
    const source = await Promise.allSettled([this.requests.runExclusive(`scheduler:page:${checkpoint.id}`, async () => {

      // Another entry point may have advanced or completed this run while this
      // caller was reconciling. Always read its durable position inside the lock.
      let current = (await this.durableActions.schedulerCheckpoints(checkpoint.accountId))
        .find((item) => item.id === checkpoint.id) ?? null;
      for (let batchPage = 0; current && batchPage < 10; batchPage += 1) {
        task?.signal.throwIfAborted();
        if (task) await this.importTasks?.fetching(task);
        await this.requireSameSession(token);
        // Absent attempt metadata is an older uncertain checkpoint, not proof
        // that a request was never sent. Manual first pages have no server run ID yet.
        if (!current.manualStart && current.attempted !== false) {
          const recovery = await this.canRecoverPage(token, current);
          if (recovery !== true) {
            if (recovery === "terminal") result.terminated = (result.terminated ?? 0) + 1;
            else result.deferred = (result.deferred ?? 0) + 1;
            return recovery === "terminal" ? "failed" : false;
          }
        }
        await this.requireSameSession(token);
        current = await this.durableActions.markSchedulerAttempted(current);
        const dispatch = current;
        const fetchPage = async () => {
          await this.requireSameSession(token);
          return this.activity.track(dispatch.lease.creatorId, "parsing", () => dispatch.manualStart
            ? this.api.manualCreatorUpdates(token, dispatch.lease.creatorId, dispatch.requestId, dispatch.idempotencyKey)
            : this.api.creatorUpdates(token, dispatch.lease, dispatch.cursor, dispatch.requestId, dispatch.idempotencyKey));
        };
        const page = dispatch.lease.trigger === "manual_check" ? await fetchPage()
          : await this.requests.enqueue(`scheduler:source:${this.nextAutomaticLane++ % 4}`, fetchPage);
        await this.requireSameSession(token);
        task?.signal.throwIfAborted();
        if (page.creatorId !== current.lease.creatorId || (!current.manualStart && page.fetchRunId !== current.lease.leaseId)) {
          throw new Error("Scheduler response identity changed; reconcile before writing.");
        }
        const lease = current.manualStart ? { ...current.lease, leaseId: page.fetchRunId } : current.lease;
        if (task) await this.importTasks?.page(task, page);
        result.pages += 1;
        if (page.hasMore && (!page.cursor || page.cursor === current.cursor)) {
          throw new Error("Scheduler page is incomplete: the next cursor is missing or did not advance.");
        }
        if (!page.hasMore && (!page.coverageComplete || page.truncated)) {
          throw new Error("Scheduler coverage is incomplete; continuation requires reconciliation.");
        }
        if (page.previews.length > 0) {
          const delivery = await this.durableActions.queueSchedulerDelivery(current,
            { ...page, requestId: page.requestId ?? current.requestId }, lease, reason);
          const work = this.deliverPage(token, delivery, task);
          void work.catch(() => undefined);
          deliveries.push(work);
        }

        // Do not advance after an unjournaled local failure. Replaying this page
        // keeps the original request identity and relies on verified Vault receipts.
        current = await this.durableActions.advanceSchedulerCheckpoint(current, page.hasMore ? page.cursor : null, lease);
      }
      return current === null;
    })]);
      const settled = await Promise.allSettled(deliveries);
      for (const item of settled) if (item.status === "fulfilled") this.addSettled(result, item.value);
      const failed = settled.find(item => item.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (source[0].status === "rejected") throw source[0].reason;
      return source[0].value;
    };
    if (this.importTasks) await this.importTasks.run(checkpoint, work, explicit);
    else await work();
  }

  private deliverPage(token: string, delivery: SchedulerDelivery, task?: ImportTaskContext): Promise<BatchSaveResult> {
    return this.requests.runExclusive(delivery.id, async () => {
      await this.requireSameSession(token);
      if (!task && this.importTasks) {
        const previous = (await this.importTasks.list(delivery.accountId)).find(item => item.checkpoint.lease.leaseId === delivery.lease.leaseId);
        if (previous?.phase === "cancelled") return { successes: [], failures: [] };
      }
      const saved = await this.saveAutoPage(token, delivery.page, delivery.lease, delivery.reason, delivery.sequence, false, task);
      await this.durableActions.remove([delivery.id]);
      return saved;

    });
  }

  private async canRecoverPage(token: string, checkpoint: SchedulerCheckpoint): Promise<boolean | "terminal"> {
    const { creatorId, leaseId } = checkpoint.lease;
    let remote;
    try {
      remote = await this.api.getExecution(token, leaseId);
    } catch (error) {
      if (!(error instanceof AgentLensError) || error.status !== 404) throw error;
      const evidence = await this.api.inspectExecutionRecovery(token, creatorId, leaseId);
      await this.requireSameSession(token);
      if (evidence.disposition !== "not_started") return false;
      const resumed = await this.api.resumeUnstartedExecution(token, creatorId, leaseId, evidence.configRevision);
      await this.requireSameSession(token);
      return resumed.disposition === "not_started";
    }
    await this.requireSameSession(token);
    if (remote.operationId !== leaseId || remote.creatorId !== creatorId
      || remote.target.installationId !== checkpoint.installationId
      || remote.target.bindingId !== creatorId || remote.target.folderPath !== checkpoint.lease.saveFolderPath) {
      throw new Error("Execution recovery target changed; reconcile before writing.");
    }
    // A completed page must still be consumed locally using its original page
    // request. Later-page failure does not erase an earlier durable delivery.
    if (remote.latestPageNumber >= checkpoint.pageNumber) return true;
    if (remote.sourceStatus === "failed" || remote.sourceStatus === "coverage_incomplete") {
      await this.durableActions.markSchedulerTerminal(checkpoint, remote.sourceStatus);
      return "terminal";
    }
    if (remote.sourceStatus === "retry_pending" && remote.retryAt !== null
      && Number.isFinite(Date.parse(remote.retryAt)) && Date.parse(remote.retryAt) <= Date.now()) return true;
    // Running, terminal failure, unknown status, and unresolved evidence cannot
    // establish that dispatch is safe. Retain the checkpoint for later evidence.
    return false;
  }

  private requireOnline(): void {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new Error("AgentLens is offline. Reconnect before checking again.");
  }

  private async requireSameSession(token: string): Promise<void> {
    this.requireOnline();
    if (await this.auth.accessToken() !== token) throw new Error("The account session changed; scheduler recovery is deferred.");
  }

  private addSettled(result: SchedulerRunResult, settled: BatchSaveResult): void {
    result.saved += settled.successes.length;
    result.failed += settled.failures.length;
  }

  private async saveAutoPage(
    token: string,
    page: CreatorUpdatePage,
    lease: SchedulerLease,
    reason: string,
    sequence?: number,
    confirmOnly: boolean | "reuse" = false,
    task?: ImportTaskContext
  ): Promise<BatchSaveResult> {
    const session = await this.indexedContext?.session();
    if (this.indexedContext && (!session || session.accessToken !== token))
      throw new Error("The account session changed before the page could be delivered.");
    const scope = session ? { userId: session.userId, installationId: session.installationId, creatorId: page.creatorId } : undefined;
    const indexedRequest = scope && reason.startsWith("indexed_scheduler:")
      ? { ...autoWriteRequest(page, reason, []), writeAttemptId: `${page.leaseId}:${page.fetchId}:${reason.split(":").slice(1).join(":")}` } : undefined;

    const previews: PreviewResult[] = page.previews.map((post) => ({
      post,
      fetchId: page.fetchId,
      deferredMedia: page.deliveryDeferredMedia,
      fetchRunId: page.fetchRunId,
      fetchRunSequence: sequence,
      indexedWrite: scope && indexedRequest ? { scope, request: indexedRequest, folderPath: lease.saveFolderPath } : undefined,
      monitoringInstanceId: page.creatorId,
      demo: false
    }));
    const saved: BatchSaveResult = { successes: [], failures: [] };
    const callbackResults: WriteResultInput[] = [];
    const completedWriteIds: string[] = [];
    for (const preview of previews) {
      if (confirmOnly) {
        await this.requireSameSession(token);
        const write = await this.operations.confirmIndexedWrite?.(preview, confirmOnly === "reuse");
        if (!write) saved.failures.push({ preview, error: "The original write still needs verification." });
        else {
          saved.successes.push({ write, callback: "pending" }); callbackResults.push(writeResult(write));
          if (write.ledger.completion === "partial") saved.failures.push({ preview, error: "Remaining attachments are awaiting recovery." });
        }
      } else await this.savePreview(token, page, lease, reason, preview, saved, callbackResults, completedWriteIds, task);
    }
    if ((!confirmOnly || saved.failures.length === 0) && !saved.failures.some(item => item.code === "WRITE_REQUIRES_RECONCILIATION"))
      await this.settleCallbacks(token, page, reason, saved, callbackResults, completedWriteIds, scope);

    // Unknown physical writes remain in the indexed reconciliation queue; they
    // must not be published as failed imports or become a second retry intent.
    if (scope && indexedRequest && this.importTasks && !saved.failures.some(item => item.code === "WRITE_REQUIRES_RECONCILIATION")) {
      const operation = await this.indexedContext?.store.get(scope, page.fetchRunId);
      await this.importTasks.recordIndexedDelivery({ id: `indexed:${scope.installationId}:${page.fetchRunId}`,
        accountId: scope.userId, installationId: scope.installationId, lease, cursor: page.cursor,
        pageNumber: 1, requestId: page.requestId ?? page.fetchId, idempotencyKey: page.fetchRunId, sequence }, page,
      saved.successes.flatMap(({write}) => {
        const preview = previews.find(item => contentKey(item.post) === write.manifest.contentKey);
        return preview ? [{preview, write}] : [];
      }), saved.failures.map(item => item.error), operation?.executionStartedAt ?? operation?.queuedAt);
    }

    return saved;
  }

  private async savePreview(
    token: string,
    page: CreatorUpdatePage,
    lease: SchedulerLease,
    reason: string,
    preview: PreviewResult,
    saved: BatchSaveResult,
    callbackResults: WriteResultInput[],
    completedWriteIds: string[],
    task?: ImportTaskContext
): Promise<void> {
    task?.signal.throwIfAborted();
    await this.requireSameSession(token);
    let manifest: NoteWriteManifest | null = null;
    let pendingActionId: string | null = null;
    const indexed = reason.startsWith("indexed_scheduler:");
    try {
      const options = { folderPath: lease.saveFolderPath, templateId: lease.noteTemplateId, mediaPolicy: lease.mediaPolicy };
      manifest = await this.operations.planPreview(preview, options);
      if (!indexed) pendingActionId = await this.durableActions.prepareWrite(
        preview,
        options,
        autoWriteRequest(page, reason, [{
          contentKey: manifest.contentKey,
          notePath: manifest.notePath,
          status: "failed",
          errorCode: "VAULT_WRITE_INTERRUPTED"
        }]),
        `auto-write-retry-${page.leaseId}-${manifest.contentKey}`
      );
      const write = task ? await this.operations.writeLocal(preview, manifest, task) : await this.operations.writeLocal(preview, manifest);
      task?.signal.throwIfAborted();
      if (pendingActionId) completedWriteIds.push(pendingActionId);

      saved.successes.push({ write, callback: "not_required" });
      callbackResults.push(writeResult(write));
      if (indexed) {
        const failed = write.attachments.filter(item => item.status === "failed");
        if (failed.length) saved.failures.push({ preview,
          mediaFailures: failed.map(item => ({ mediaId: item.mediaId, kind: item.failureKind ?? "retryable", ...(item.deferred ? { deferred: true } : {}) })),
          error: failed.map(item => item.error ?? "Media download source is unavailable.").join("; ") });
      }
    } catch (error) {
      if (task?.signal.aborted) {
        if (pendingActionId) await this.durableActions.removeWrites([pendingActionId]);
        throw error;
      }
      if (indexed && error instanceof AgentLensError && error.serverCode === "WRITE_REQUIRES_RECONCILIATION") {
        saved.failures.push({ preview, error: error.message, code: error.serverCode,
          ...(error instanceof MediaWriteUncertainError ? { mediaFailures: [{ mediaId: error.mediaId, kind: "write_unknown" as const }] } : {}) }); return;
      }
      if (!pendingActionId && !indexed) throw error;

      saved.failures.push({ preview, error: error instanceof Error ? error.message : "Vault write failed." });
      if (manifest) {
        callbackResults.push({
          contentKey: manifest.contentKey,
          notePath: manifest.notePath,
          status: "failed",
          errorCode: "VAULT_WRITE_FAILED"
        });
        if (pendingActionId) await this.durableActions.markWriteFailed(pendingActionId, preview, manifest);
      }
    }
  }

  private async settleCallbacks(
    token: string,
    page: CreatorUpdatePage,
    reason: string,
    saved: BatchSaveResult,
    callbackResults: WriteResultInput[],
    completedWriteIds: readonly string[],
    scope?: OperationScope
  ): Promise<void> {

    if (callbackResults.length === 0) return;
    const request = { ...autoWriteRequest(page, reason, callbackResults),
      ...(reason.startsWith("indexed_scheduler:") ? { writeAttemptId: `${page.leaseId}:${page.fetchId}:${reason.split(":").slice(1).join(":")}` } : {}) };
    let idempotencyKey = `auto-results-${page.leaseId}-${page.requestId ?? this.createId()}${reason.startsWith("indexed_scheduler:") ? `-${reason}` : ""}`;
    if (page.deliveryItemKey !== undefined) {
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([idempotencyKey, page.deliveryItemKey]))));
      idempotencyKey = `auto-results-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
    }
    if (scope && this.indexedContext && this.callbacks) {
      const callback = await this.indexedContext.store.queueCallback(scope, idempotencyKey, request);
      await this.durableActions.removeWrites(completedWriteIds);
      const acknowledged = await this.callbacks.send(callback);
      saved.successes = saved.successes.map(({ write }) => ({ write, callback: acknowledged ? "acknowledged" : "pending" }));
      return;
    }
    await this.durableActions.queueCallback(request, idempotencyKey, completedWriteIds);
    try {
      await this.api.writeResults(token, request, idempotencyKey);
      saved.successes = saved.successes.map(({ write }) => ({ write, callback: "acknowledged" }));

      await this.durableActions.clearCallback(idempotencyKey);
    } catch {
      saved.successes = saved.successes.map(({ write }) => ({ write, callback: "pending" }));
    }
  }

  private async requireAccessToken(): Promise<string> {
    const token = await this.auth.accessToken();
    if (!token) throw new Error("Sign in to AgentLens first.");
    return token;
  }
}
