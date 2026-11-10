import { recordDiagnostic } from "../diagnostics/log";
import { hostExecutionLocks } from "../runtime/HostExecutionLocks";
import type { CreatorRecord, SchedulerLease } from "../api/AgentLensApiClient";
import type { AgentLensApiPort } from "../workbench/ports";
import { AgentLensError } from "../core/errors";
import { OperationStore, type OperationScope, type SourceOperation } from "./operation-store";

export interface SourceContext {
  userId: string;
  installationId: string;
  accessToken: string;
  online: boolean;
  creator: CreatorRecord | undefined;
}
export interface SourceExecutorDependencies {
  sharedDestinationReady?(creator: CreatorRecord): Promise<boolean>;
  destinationAvailable?(operation: SourceOperation): Promise<boolean>;
  configurationReady?(operation: SourceOperation): Promise<boolean>;
  store: OperationStore;
  api: Pick<AgentLensApiPort, "creatorUpdates" | "getExecution" | "inspectExecutionRecovery" | "resumeUnstartedExecution" | "reportDestinationFailure">;
  /** Fresh account/installation/network and binding facts, including after awaited host work. */
  context(scope: OperationScope): Promise<SourceContext | undefined>;
  createId(): string;
  now(): Date;
}
export type SourceStep = "deferred" | "cancelled" | "failed" | "page_saved";

/** One bounded source page. Durable deliveries never hold this source executor open. */
export class SourceExecutor {
  private readonly active = new Map<string, Promise<SourceStep>>();
  constructor(private readonly dependencies: SourceExecutorDependencies) {}

  run(scope: OperationScope, operationId: string): Promise<SourceStep> {
    const key = JSON.stringify([scope, operationId]);
    const previous = this.active.get(key);
    if (previous) return previous;
    const work = hostExecutionLocks.tryRun(["source", scope.userId, scope.installationId, scope.creatorId, operationId],
      async () => {
        const startedAt = Date.now();
        recordDiagnostic("source.started", scope, { creatorId: scope.creatorId, operationId });
        try {
          const result = await this.runOnce(scope, operationId);
          recordDiagnostic("source.finished", scope, { creatorId: scope.creatorId, operationId, result, durationMs: Date.now() - startedAt });
          return result;
        } catch (error) {
          recordDiagnostic("source.interrupted", scope, { creatorId: scope.creatorId, operationId, durationMs: Date.now() - startedAt });
          throw error;
        }
      }, (): SourceStep => "deferred").finally(() => { this.active.delete(key); });
    this.active.set(key, work);
    return work;
  }

  private async current(scope: OperationScope): Promise<SourceContext | undefined> {
    const value = await this.dependencies.context(scope);
    return value?.online && value.accessToken && value.userId === scope.userId
      && value.installationId === scope.installationId ? value : undefined;
  }

  private async runOnce(scope: OperationScope, id: string): Promise<SourceStep> {
    const { store, api } = this.dependencies;
    let operation = await store.get(scope, id);
    if (!operation || ["failed", "cancelled", "source_succeeded"].includes(operation.status)) return "deferred";
    let context = await this.current(scope);
    if (!context) return "deferred";
    if (operation.status === "running" || operation.status === "requires_reconciliation") {
      const evidence = await this.recover(scope, operation, context.accessToken);
      if (evidence !== "ready") return evidence === "failed" ? "failed" : "deferred";
      operation = await store.transition(scope, id, operation.version, { status: "waiting_continuation" });
      if (!operation) return "deferred";
    }
    if (operation.retryAt && Date.parse(operation.retryAt) > this.dependencies.now().getTime()) return "deferred";
    context = await this.current(scope);
    if (!context) return "deferred";
    if (operation.status === "queued" && !await this.configurationReady(operation)) return "deferred";
    if(operation.status==="queued" && !operation.executionStartedAt && !operation.dispatchedAt && operation.attempts===0
        && context.creator && context.creator.saveFolderPath!==operation.snapshot.saveFolderPath
        && configurationMatches({...context.creator,saveFolderPath:operation.snapshot.saveFolderPath},operation)
        && await this.dependencies.sharedDestinationReady?.(context.creator)) {
      const refreshed=await store.transition(scope,id,operation.version,{snapshot:{...operation.snapshot,saveFolderId:operation.snapshot.saveFolderId === undefined ? undefined : `vault:${context.creator.saveFolderPath}`,saveFolderPath:context.creator.saveFolderPath}});
      if(!refreshed)return "deferred";operation=refreshed;
    }
    if (operation.status === "queued" && (!context.creator || !configurationMatches(context.creator, operation))) {
      await store.transition(scope, id, operation.version, { status: "cancelled",
        cancellationReason: context.creator ? "configuration_changed" : "deleted" });
      return "cancelled";
    }
    if (operation.status === "queued" && this.dependencies.destinationAvailable && !await this.dependencies.destinationAvailable(operation)) {
      const refreshed = await this.current(scope);
      if (!refreshed || refreshed.accessToken !== context.accessToken) return "deferred";
      if (api.reportDestinationFailure) await api.reportDestinationFailure(context.accessToken,{creatorId: scope.creatorId,operationId: id,trigger: operation.trigger,...(operation.plan ? {plan: operation.plan} : {})});
      await store.transition(scope,id,operation.version,{status: "failed",errorCode: "DESTINATION_PATH_INVALID",errorMessage: "The configured folder is no longer available.",completedAt: this.dependencies.now().toISOString()});
      return "failed";
    }
    const now = this.dependencies.now().toISOString();
    const requestId = operation.requestId ?? this.dependencies.createId();
    const attemptKey = operation.attemptKey ?? `auto-${id}-${operation.pageNumber ?? 1}`;
    const claimed = await store.transition(scope, id, operation.version, { status: "running", requestId,
      attemptKey, attempts: operation.attempts + 1, executionStartedAt: operation.executionStartedAt ?? now,
      dispatchedAt: now });
    if (!claimed) return "deferred";
    let sent = false;
    try {
      const sending = await this.current(scope);
      if (!sending || sending.accessToken !== context.accessToken) {
        // This claim is positively unsent. Unknown requests never take this path.
        await store.transition(scope, id, claimed.version, { status: operation.status,
          executionStartedAt: operation.executionStartedAt, dispatchedAt: operation.dispatchedAt,
          attempts: operation.attempts });
        return "deferred";
      }
      if (operation.status === "queued" && (!sending.creator || !configurationMatches(sending.creator, operation))) {
        const restored = await store.transition(scope, id, claimed.version, { status: "queued", attempts: 0,
          executionStartedAt: undefined, dispatchedAt: undefined });
        if (restored) await store.transition(scope, id, restored.version, { status: "cancelled",
          cancellationReason: sending.creator ? "configuration_changed" : "deleted" });
        return "cancelled";
      }
      const snapshot = operation.snapshot;
      if (!snapshot.noteTemplateId || !snapshot.mediaPolicy) throw new Error("The saved destination configuration is incomplete.");
      const lease: SchedulerLease = { creatorId: scope.creatorId, leaseId: id,
        trigger: operation.cursor ? "continuation" : operation.trigger, plan: operation.plan,
        saveFolderPath: snapshot.saveFolderPath, noteTemplateId: snapshot.noteTemplateId,
        mediaPolicy: snapshot.mediaPolicy, schedulerState: "due", nextCheckAt: null };
      if (operation.status === "queued" && !await this.configurationReady(operation)) {
        await store.transition(scope, id, claimed.version, { status: "queued", attempts: operation.attempts,
          executionStartedAt: operation.executionStartedAt, dispatchedAt: operation.dispatchedAt });
        return "deferred";
      }
      sent = true;
      const page = await api.creatorUpdates(context.accessToken, lease, operation.cursor ?? null, requestId, attemptKey);
      const receiving = await this.current(scope);
      if (!receiving || receiving.accessToken !== context.accessToken) throw new Error("Source ownership changed before the response was persisted.");
      const saved = await store.acceptPage(scope, id, claimed.version, page, this.dependencies.now().toISOString());
      return saved ? "page_saved" : "deferred";
    } catch (error) {
      const definitive = error instanceof AgentLensError && !["network_unavailable", "invalid_response"].includes(error.code)
        && (!error.retryable || error.execution !== undefined)
        && error.serverCode !== "IDEMPOTENCY_IN_PROGRESS" && error.execution?.failureClass !== "reconciliation_required";
      const retryAt = error instanceof AgentLensError ? error.execution?.retryAt : undefined;
      const retry = definitive && error instanceof AgentLensError && error.code !== "quota_exhausted"
        && error.execution?.retryable === true && retryAt && Number.isFinite(Date.parse(retryAt));
      await store.transition(scope, id, claimed.version, { status: retry ? "retry_pending" : definitive || !sent ? "failed" : "requires_reconciliation",
        retryAt: retry ? retryAt : undefined,
        errorCode: error instanceof AgentLensError ? error.serverCode ?? error.code : undefined,
        errorMessage: error instanceof Error ? error.message : String(error) });
      return "failed";
    }
  }

  private async configurationReady(operation: SourceOperation): Promise<boolean> {
    try { return this.dependencies.configurationReady ? await this.dependencies.configurationReady(operation) : true; }
    catch { return false; } // Storage/session uncertainty is positively unsent, not a failed provider request.
  }

  private async recover(scope: OperationScope, operation: SourceOperation, token: string): Promise<"ready" | "failed" | "wait"> {
    const { api, store } = this.dependencies;
    try {
      const remote = await api.getExecution(token, operation.operationId);
      if ((await this.current(scope))?.accessToken !== token) return "wait";
      if (remote.operationId !== operation.operationId || remote.creatorId !== scope.creatorId
          || remote.target.installationId !== scope.installationId || remote.target.bindingId !== scope.creatorId
          || remote.target.folderPath !== operation.snapshot.saveFolderPath) throw new Error("Execution recovery target changed.");
      // Replay this completed page before considering a later terminal outcome.
      if (remote.latestPageNumber >= (operation.pageNumber ?? 1)) return "ready";
      if (["failed", "coverage_incomplete"].includes(remote.sourceStatus)) {
        await store.transition(scope, operation.operationId, operation.version, { status: "failed" });
        return "failed";
      }
      if (remote.sourceStatus === "retry_pending" && remote.retryAt
          && Date.parse(remote.retryAt) <= this.dependencies.now().getTime()
          && remote.jobs?.some(job => job.status === "retry_pending" && job.retryable && job.retryCount < job.maxRetries)
          && !remote.jobs.some(job => ["processing", "dispatched", "requires_reconciliation"].includes(job.status))) return "ready";
      return "wait";
    } catch (error) {
      if (!(error instanceof AgentLensError) || error.status !== 404) throw error;
      const evidence = await api.inspectExecutionRecovery(token, scope.creatorId, operation.operationId);
      const context = await this.current(scope);
      if (context?.accessToken !== token || !context.creator || !configurationMatches(context.creator, operation)
          || evidence.operationId !== operation.operationId || evidence.creatorId !== scope.creatorId
          || evidence.disposition !== "not_started") return "wait";
      const resumed = await api.resumeUnstartedExecution(token, scope.creatorId, operation.operationId, evidence.configRevision);
      return (await this.current(scope))?.accessToken === token && resumed.disposition === "not_started"
        && resumed.configRevision === evidence.configRevision && resumed.operationId === operation.operationId
        && resumed.creatorId === scope.creatorId ? "ready" : "wait";
    }
  }
}

/** Pause changes admission only; all other queued target/settings changes fence dispatch. */
function configurationMatches(creator: CreatorRecord, operation: SourceOperation): boolean {
  const original = operation.snapshot;
  return creator.creatorId === original.creatorId
    && creator.targetId === original.targetId
    && !!original.followId
    && (creator.followId === original.followId || (!!creator.followId && creator.legacyFollowId === original.followId))
    && creator.saveFolderPath === original.saveFolderPath
    && creator.noteTemplateId === original.noteTemplateId && creator.mediaPolicy === original.mediaPolicy
    && creator.scheduleAnchorAt === original.scheduleAnchorAt
    && creator.frequency.every === original.frequency.every && creator.frequency.unit === original.frequency.unit;
}
