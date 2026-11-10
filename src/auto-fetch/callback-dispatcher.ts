import { recordDiagnostic } from "../diagnostics/log";
import { AgentLensError } from "../core/errors";
import type { AgentLensApiPort } from "../workbench/ports";
import type { RequestCoordinator } from "../runtime/RequestCoordinator";
import type { SchedulerSession } from "./indexed-scheduler";
import { OperationStore, type IndexedCallback } from "./operation-store";

interface Dependencies {
  store: OperationStore;
  api: Pick<AgentLensApiPort, "writeResults">;
  requests: RequestCoordinator;
  session(): Promise<SchedulerSession | undefined>;
  now(): number;
}

/** Remote receipt replay never changes local save statistics or starts a source request. */
export class CallbackDispatcher {
  constructor(private readonly dependencies: Dependencies) {}

  async flush(): Promise<number> {
    const session = await this.dependencies.session();
    if (!session) return 0;
    const callbacks = await this.dependencies.store.dueCallbacks(session, this.dependencies.now());
    let completed = 0;
    for (const callback of callbacks) if (await this.send(callback)) completed++;
    return completed;
  }

  send(record: IndexedCallback): Promise<boolean> {
    return this.dependencies.requests.runExclusive(`indexed:callback:${JSON.stringify(record.scope)}:${record.idempotencyKey}`, async () => {
      const session = await this.dependencies.session();
      if (!session || session.userId !== record.scope.userId || session.installationId !== record.scope.installationId) return false;
      const current = await this.dependencies.store.callback(record.scope, record.idempotencyKey);
      if (!current) return false;
      if (current.status === "acknowledged") return true;
      if (current.status !== "pending" || current.readyAt > this.dependencies.now()) return false;
      const claimed = await this.dependencies.store.updateCallback(current, { status: "pending", attempts: current.attempts + 1,
        readyAt: this.dependencies.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(7, current.attempts + 1)) });
      if (!claimed) return false;
      try {
        if (!await this.sameSession(session)) return false;
        recordDiagnostic("callback.started", record.scope, { creatorId: record.scope.creatorId,
          operationId: claimed.request.fetchRunId, attempts: claimed.attempts });
        const ack = await this.dependencies.api.writeResults(session.accessToken, claimed.request, claimed.idempotencyKey);
        if (!await this.sameSession(session)) return false;
        if (ack.accepted !== claimed.request.results.length || ack.success + ack.partial + ack.failed + ack.skipped !== ack.accepted)
          throw new Error("The callback acknowledgement is incomplete.");
        const confirmed = Boolean(await this.dependencies.store.updateCallback(claimed, {
          status: "acknowledged", attempts: claimed.attempts, readyAt: claimed.readyAt
        }));
        if (confirmed) recordDiagnostic("callback.acknowledged", record.scope, { creatorId: record.scope.creatorId,
          operationId: claimed.request.fetchRunId, attempts: claimed.attempts });
        return confirmed;
      } catch (error) {
        recordDiagnostic("callback.unconfirmed", record.scope, { creatorId: record.scope.creatorId,
          operationId: claimed.request.fetchRunId, attempts: claimed.attempts,
          httpStatus: error instanceof AgentLensError ? error.status : undefined });
        if (error instanceof AgentLensError && error.status !== undefined && error.status >= 400 && error.status < 500
          && ![401, 403, 408, 429].includes(error.status)) {
          await this.dependencies.store.updateCallback(claimed, { status: "requires_reconciliation",
            attempts: claimed.attempts, readyAt: claimed.readyAt });
        }
        return false;
      }
    });
  }

  private async sameSession(expected: SchedulerSession): Promise<boolean> {
    const current = await this.dependencies.session();
    return Boolean(current && current.userId === expected.userId && current.installationId === expected.installationId
      && current.accessToken === expected.accessToken && current.epoch === expected.epoch);
  }
}
