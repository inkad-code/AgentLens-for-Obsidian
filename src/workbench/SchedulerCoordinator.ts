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
import type { DurableActionStore, SchedulerCheckpoint } from "./DurableActionStore";
import type { BatchSaveResult, PreviewResult, SchedulerRunResult, WriteOptions } from "./types";
import { remoteScope } from "./identifiers";
import { autoWriteRequest, writeResult } from "./writeResults";

interface SchedulerOperations {
  requireSupportedVersion(accessToken: string): Promise<AccountCapabilities>;
  flushPendingWrites(accessToken?: string): Promise<number>;
  flushPendingCallbacks(accessToken?: string): Promise<number>;
  saveMany(previews: readonly PreviewResult[], options: WriteOptions): Promise<BatchSaveResult>;
  planPreview(preview: PreviewResult, options: WriteOptions): Promise<NoteWriteManifest>;
  writeLocal(preview: PreviewResult, manifest: NoteWriteManifest): Promise<VaultWriteResult>;
  recordCreatorSavedPage(creatorId: string, fetchRunId: string, fetchId: string, savedContentKeys: readonly string[]): Promise<void>;
}

export class SchedulerCoordinator {
  constructor(
    private readonly auth: AuthService,
    private readonly api: AgentLensApiPort,
    private readonly durableActions: DurableActionStore,
    private readonly requests: RequestCoordinator,
    private readonly createId: () => string,
    private readonly operations: SchedulerOperations
  ) {}

  runScheduled(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    return this.requests.runExclusive("scheduler:reconcile", () => this.runScheduledOnce(reason));
  }

  runCreatorNow(creator: CreatorRecord): Promise<SchedulerRunResult> {
    return this.requests.runExclusive(
      `scheduler:manual:${creator.creatorId}`,
      () => this.runCreatorNowOnce(creator)
    );
  }

  retryCreator(creator: CreatorRecord): Promise<SchedulerRunResult> {
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

  private async runScheduledOnce(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    const token = await this.auth.accessToken();
    if (!token) return { leases: 0, pages: 0, saved: 0, failed: 0, skipped: "signed_out" };
    const { accountId } = await this.operations.requireSupportedVersion(token);
    await this.operations.flushPendingWrites(token);
    await this.operations.flushPendingCallbacks(token);
    const reconciled = await this.durableActions.runRemoteAction(
      remoteScope("scheduler-reconcile", reason),
      "scheduler-reconcile",
      ({ requestId, idempotencyKey }) => this.api.reconcile(token, reason, requestId, idempotencyKey)
    );
    // Persist every admitted lease before running any of them. A failure in one
    // creator must not discard another creator's original target snapshot.
    for (const lease of reconciled.leases) await this.durableActions.prepareSchedulerCheckpoint(accountId, lease);
    const pending = await this.durableActions.schedulerCheckpoints(accountId);
    const result: SchedulerRunResult = { leases: pending.length, pages: 0, saved: 0, failed: 0, skipped: null };
    let failure: unknown;
    for (const checkpoint of pending) {
      try { await this.runCheckpoint(token, checkpoint, reason, result); }
      catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
    return result;
  }

  private async runCreatorNowOnce(creator: CreatorRecord): Promise<SchedulerRunResult> {
    const token = await this.requireAccessToken();
    const { accountId } = await this.operations.requireSupportedVersion(token);
    await this.operations.flushPendingWrites(token);
    await this.operations.flushPendingCallbacks(token);
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

  private runCheckpoint(token: string, checkpoint: SchedulerCheckpoint, reason: string,
    result: SchedulerRunResult): Promise<void> {
    return this.requests.runExclusive(`scheduler:page:${checkpoint.id}`, async () => {
      // Another entry point may have advanced or completed this run while this
      // caller was reconciling. Always read its durable position inside the lock.
      let current = (await this.durableActions.schedulerCheckpoints(checkpoint.accountId))
        .find((item) => item.id === checkpoint.id) ?? null;
      for (let batchPage = 0; current && batchPage < 10; batchPage += 1) {
        await this.requireSameSession(token);
        // Absent attempt metadata is an older uncertain checkpoint, not proof
        // that a request was never sent. Manual first pages have no server run ID yet.
        if (!current.manualStart && current.attempted !== false) {
          const recovery = await this.canRecoverPage(token, current);
          if (recovery !== true) {
            if (recovery === "terminal") result.terminated = (result.terminated ?? 0) + 1;
            else result.deferred = (result.deferred ?? 0) + 1;
            return;
          }
        }
        await this.requireSameSession(token);
        current = await this.durableActions.markSchedulerAttempted(current);
        const page = current.manualStart
          ? await this.api.manualCreatorUpdates(token, current.lease.creatorId, current.requestId, current.idempotencyKey)
          : await this.api.creatorUpdates(token, current.lease, current.cursor, current.requestId, current.idempotencyKey);
        await this.requireSameSession(token);
        if (page.creatorId !== current.lease.creatorId || (!current.manualStart && page.fetchRunId !== current.lease.leaseId)) {
          throw new Error("Scheduler response identity changed; reconcile before writing.");
        }
        const lease = current.manualStart ? { ...current.lease, leaseId: page.fetchRunId } : current.lease;
        result.pages += 1;
        if (page.hasMore && (!page.cursor || page.cursor === current.cursor)) {
          throw new Error("Scheduler page is incomplete: the next cursor is missing or did not advance.");
        }
        if (!page.hasMore && (!page.coverageComplete || page.truncated)) {
          throw new Error("Scheduler coverage is incomplete; continuation requires reconciliation.");
        }
        if (page.previews.length > 0) this.addSettled(result, await this.saveAutoPage(token,
          { ...page, requestId: page.requestId ?? current.requestId }, lease, reason));
        // Do not advance after an unjournaled local failure. Replaying this page
        // keeps the original request identity and relies on verified Vault receipts.
        current = await this.durableActions.advanceSchedulerCheckpoint(current, page.hasMore ? page.cursor : null, lease);
      }
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

  private async requireSameSession(token: string): Promise<void> {
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
    reason: string
  ): Promise<BatchSaveResult> {
    const previews: PreviewResult[] = page.previews.map((post) => ({
      post,
      fetchId: page.fetchId,
      monitoringInstanceId: page.creatorId,
      demo: false
    }));
    const saved: BatchSaveResult = { successes: [], failures: [] };
    const callbackResults: WriteResultInput[] = [];
    const completedWriteIds: string[] = [];
    for (const preview of previews) await this.savePreview(token, page, lease, reason, preview, saved, callbackResults, completedWriteIds);
    await this.settleCallbacks(token, page, reason, saved, callbackResults, completedWriteIds);
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
    completedWriteIds: string[]
  ): Promise<void> {
    await this.requireSameSession(token);
    let manifest: NoteWriteManifest | null = null;
    let pendingActionId: string | null = null;
    try {
      const options = { folderPath: lease.saveFolderPath, templateId: lease.noteTemplateId, mediaPolicy: lease.mediaPolicy };
      manifest = await this.operations.planPreview(preview, options);
      pendingActionId = await this.durableActions.prepareWrite(
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
      const write = await this.operations.writeLocal(preview, manifest);
      completedWriteIds.push(pendingActionId);
      saved.successes.push({ write, callback: "not_required" });
      callbackResults.push(writeResult(write));
    } catch (error) {
      if (!pendingActionId) throw error;
      saved.failures.push({ preview, error: error instanceof Error ? error.message : "Vault write failed." });
      if (manifest && pendingActionId) {
        callbackResults.push({
          contentKey: manifest.contentKey,
          notePath: manifest.notePath,
          status: "failed",
          errorCode: "VAULT_WRITE_FAILED"
        });
        await this.durableActions.markWriteFailed(pendingActionId, preview, manifest);
      }
    }
  }

  private async settleCallbacks(
    token: string,
    page: CreatorUpdatePage,
    reason: string,
    saved: BatchSaveResult,
    callbackResults: WriteResultInput[],
    completedWriteIds: readonly string[]
  ): Promise<void> {
    if (callbackResults.length === 0) return;
    const request = autoWriteRequest(page, reason, callbackResults);
    const idempotencyKey = `auto-results-${page.leaseId}-${page.requestId ?? this.createId()}`;
    await this.durableActions.queueCallback(request, idempotencyKey, completedWriteIds);
    try {
      await this.api.writeResults(token, request, idempotencyKey);
      saved.successes = saved.successes.map(({ write }) => ({ write, callback: "acknowledged" }));
      await this.operations.recordCreatorSavedPage(
        page.creatorId,
        page.fetchRunId,
        page.fetchId,
        callbackResults.filter((result) => result.status !== "failed").map((result) => result.contentKey)
      );
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
