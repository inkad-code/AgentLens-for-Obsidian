import { safeFields, type DiagnosticLog, type DiagnosticScope } from "./log";
import type { OperationStore, SourceStatus } from "../auto-fetch/operation-store";

export interface DiagnosticExportDependencies {
  scope: DiagnosticScope;
  operations: OperationStore;
  log?: DiagnosticLog | undefined;
  assertCurrent: () => Promise<void>;
  now?: (() => number) | undefined;
}

/** Local reads only. Separate stores are deliberately not presented as an atomic snapshot. */
export async function buildDiagnosticPackage(dependencies: DiagnosticExportDependencies) {
  const { scope, operations, log, assertCurrent } = dependencies;
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  await assertCurrent();
  const warnings: string[] = [];
  const events = await (log ? log.read(scope, startedAt - 24 * 60 * 60 * 1000) : Promise.reject(new Error("Unavailable")))
    .catch(() => {
      warnings.push("diagnostic_storage_unavailable");
      return { events: [], retainedFrom: undefined, dropped: log?.dropped ?? 0, storageFailures: log?.storageFailures ?? 0 };
    });
  await assertCurrent();
  const queues: Array<Record<string, unknown>> = [];
  const scopes = await operations.scopes(scope).catch(() => { warnings.push("operation_scopes_unavailable"); return undefined; });
  if (scopes?.next) warnings.push("operation_creators_truncated");
  const statuses: SourceStatus[] = ["queued", "running", "waiting_continuation", "retry_pending", "requires_reconciliation", "source_succeeded", "failed", "cancelled"];
  for (const owner of scopes?.scopes ?? []) {
    await assertCurrent();
    try {
      const watermark = await operations.watermark(owner);
      if (watermark) queues.push({ creatorId: safeFields({ ...owner }).creatorId, watermark: safeFields({ ...watermark }) });
      for (const status of statuses) {
        await assertCurrent();
        const page = await operations.list(owner, status, 5);
        const items = [];
        for (const operation of page.operations) {
          const summary = await operations.taskSummary(owner, operation.operationId);
          items.push({ ...safeFields({ ...operation, hasCursor: Boolean(operation.cursor) }),
            delivery: summary?.delivery,
            statistics: summary?.statistics ? { ...safeFields({ ...summary.statistics }),
              savedCount: summary.statistics.savedCount, reusedCount: summary.statistics.reusedCount } : undefined,
            deliveryCompletedAt: safeFields({ completedAt: summary?.deliveryCompletedAt }).completedAt });
        }
        if (items.length || page.next) queues.push({ creatorId: safeFields({ ...owner }).creatorId, status, items, truncated: Boolean(page.next) });
      }
    } catch {
      // Session changes must abort, not be converted into a partial export.
      await assertCurrent();
      warnings.push("operation_snapshot_unavailable");
    }
  }
  const callbacks: Array<Record<string, unknown>> = [];
  for (const status of ["pending", "acknowledged", "requires_reconciliation"] as const) {
    await assertCurrent();
    try {
      const page = await operations.callbackDiagnostics(scope, status);
      callbacks.push({ status, truncated: page.truncated, items: page.items.map(item => safeFields({ ...item,
        nextAttemptAt: Number.isFinite(item.readyAt) && Math.abs(item.readyAt) <= 8640000000000000 ? new Date(item.readyAt).toISOString() : undefined })) });
    } catch { warnings.push("callback_snapshot_unavailable"); }
  }
  await assertCurrent();
  return {
    schema: "agentlens.obsidian.local-diagnostics.v1",
    generatedAt: new Date(now()).toISOString(), snapshotStartedAt: new Date(startedAt).toISOString(), scope: safeFields({ ...scope }),
    collection: { atomicSnapshot: false, completeness: "best_effort", requestedHours: 24, maxRetentionHours: 72,
      maxRetainedEvents: 4000, maxEventBytes: 2048, maxCreators: 25, maxOperationsPerStatusPerCreator: 5,
      operationOrder: "oldest_first", maxCallbacksPerStatus: 25, droppedThisSession: events.dropped,
      storageFailuresThisSession: events.storageFailures, retainedFrom: events.retainedFrom, warnings: [...new Set(warnings)],
      note: "Missing observations do not prove that an operation did not execute." },
    queues, callbacks, events: events.events,
  };
}
export type DiagnosticPackage = Awaited<ReturnType<typeof buildDiagnosticPackage>>;
