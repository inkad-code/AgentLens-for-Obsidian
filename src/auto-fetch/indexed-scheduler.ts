import { recordDiagnostic } from "../diagnostics/log";
import { requireMatchingExecutionTarget } from "../runtime/NativeExecutionTarget";
import type { AutoFetchActivityScope } from "../workbench/AutoFetchActivity";
import { hostExecutionLocks } from "../runtime/HostExecutionLocks";
import { latestResumeAt } from "./schedule-slots";
import type { CreatorRecord, CreatorUpdatePage, SchedulerLease, SchedulerReconcileReason } from "../api/AgentLensApiClient";
import type { ScheduleRevision } from "../api/scheduleHistory";
import { validateScheduleHistory } from "../api/scheduleHistory";
import type { AgentLensApiPort } from "../workbench/ports";
import type { BatchSaveResult, SchedulerRunResult } from "../workbench/types";
import type { RequestCoordinator } from "../runtime/RequestCoordinator";
import { OperationStore, type OperationScope, type SourceStatus } from "./operation-store";
import { SourceExecutor } from "./source-executor";
import { admitOperations } from "./admit-operations";
import { registerDevelopmentCreator, registerNewCreator } from "./register-creator";

export interface SchedulerSession {
  targetId?: string | undefined;
  userId: string; installationId: string; accessToken: string; epoch: number; sequenceFloor: number;
}
interface Dependencies {
  sharedDestinationReady?(session: SchedulerSession, creator: import("../api/AgentLensApiClient").CreatorRecord): Promise<boolean>;
  destinationAvailable?(session: SchedulerSession, operation: import("../auto-fetch/operation-store").SourceOperation): Promise<boolean>;
  configurationReady?(session: SchedulerSession, followId: string | undefined): Promise<boolean>;
  store: OperationStore;
  api: AgentLensApiPort;
  requests: RequestCoordinator;
  session(): Promise<SchedulerSession | undefined>;
  deliver(token: string, page: CreatorUpdatePage, lease: SchedulerLease, sequence: number, attempt: number, confirmOnly?: boolean | "reuse"): Promise<BatchSaveResult>;
  source<T>(creatorId: string, task: () => Promise<T>, activityScope: AutoFetchActivityScope): Promise<T>;
  now(): Date;
  createId(): string;
}

/** Admission has its own short queue. Neither source requests nor Vault writes hold it. */
export class IndexedScheduler {
  private generation = 0;
  private readonly prepared = new Set<string>();
  private readonly positions = new Map<string, { sequence: number }>();
  private lane = 0;
  private readonly unknownPositions = new Map<string, { readyAt: number; sequence: number; pageNumber: number; itemKey?: string }>();
  private readonly scopePositions = new Map<string, string>();
  private readonly manualAdmissions = new Set<string>();
  private readonly deliveryFlights = new Map<string, { requested: boolean }>();
  constructor(private readonly dependencies: Dependencies) {}

  async register(creator: CreatorRecord, startedAt: string): Promise<void> {
    const session = await this.dependencies.session();
    if (session) await registerNewCreator(this.dependencies.store, this.scope(session, creator), creator, startedAt);
  }

  async run(reason: SchedulerReconcileReason): Promise<SchedulerRunResult> {
    if (reason !== "periodic_tick") { this.generation++; this.prepared.clear(); }
    const session = await this.dependencies.session();
    if (!session) return { leases: 0, pages: 0, saved: 0, failed: 0, skipped: "signed_out" };
    const result: SchedulerRunResult = { leases: 0, pages: 0, saved: 0, failed: 0, skipped: null };
    if (this.dependencies.requests.has("indexed:admission")) return { ...result, deferred: 1 };
    const scopes = await this.dependencies.requests.runExclusive("indexed:admission", async () => {
      await this.requireSession(session);
      const generation = this.generation;
      const creators = await this.dependencies.api.listCreators(session.accessToken);
      await this.requireSession(session);
      const scopes: OperationScope[] = [];
      for (const creator of creators) {
        await this.requireSession(session);
        if (creator.targetId && creator.targetId !== session.targetId) { result.failed++; continue; }
        const scope = this.scope(session, creator);
        if (!creator.followId || !creator.configRevision) { result.failed++; continue; }
        await registerDevelopmentCreator(this.dependencies.store, scope, creator,
          this.dependencies.now().toISOString(), session.sequenceFloor);
        scopes.push(scope);
        if (!creator.autoFetchEnabled) continue;
        try {
          const history = await this.history(session, creator);
          await this.requireSession(session);
          const resumedAt = latestResumeAt(history);
          if (resumedAt) await this.dependencies.store.resetCreatorStatus(scope, resumedAt);
          const watermark = (await this.dependencies.store.watermark(scope))!;
          const admitted = await admitOperations(this.dependencies.store, { scope, binding: creator, history,
            now: this.dependencies.now().toISOString(), initialThrough: watermark.observedThrough,
            mode: this.prepared.has(JSON.stringify(scope)) ? "normal" : "recovery" });
          result.leases += admitted.operationIds.length;
          if (admitted.committed && generation === this.generation) this.prepared.add(JSON.stringify(scope));
        } catch { result.failed++; } // One unavailable schedule does not discard another binding's tasks.
      }
      const ownerKey = JSON.stringify([session.userId, session.installationId]);
      const stored = await this.dependencies.store.scopes({ userId: session.userId, installationId: session.installationId },
        this.scopePositions.get(ownerKey));
      if (stored.next) this.scopePositions.set(ownerKey, stored.next); else this.scopePositions.delete(ownerKey);
      while (this.scopePositions.size > 16) this.scopePositions.delete(this.scopePositions.keys().next().value!);
      const all = new Map(scopes.map(scope => [scope.creatorId, scope]));
      for (const scope of stored.scopes) all.set(scope.creatorId, scope);
      return [...all.values()];
    });
    const settled = await Promise.allSettled(scopes.map(scope => this.pump(session, scope, result)));
    const failure = settled.find(item => item.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    return result;
  }

  async manual(creator: CreatorRecord): Promise<SchedulerRunResult> {
    const session = await this.dependencies.session();
    if (!session) throw new Error("Sign in to AgentLens first.");
    return hostExecutionLocks.tryRun(["manual", session.userId, session.installationId, creator.creatorId],
      () => this.manualOnce(creator, session), () => { throw new Error("This manual check is already running in another window."); });
  }

  private async manualOnce(creator: CreatorRecord, session: SchedulerSession): Promise<SchedulerRunResult> {
    const scope = this.scope(session, creator);
    const fresh = (await this.dependencies.api.listCreators(session.accessToken)).find(item => item.creatorId === creator.creatorId);
    if (!fresh?.configRevision || !fresh.followId) throw new Error("Synchronize the creator before checking again.");
    await this.requireSession(session);
    await registerDevelopmentCreator(this.dependencies.store, scope, fresh, this.dependencies.now().toISOString(), session.sequenceFloor);
    for (const status of ["requires_reconciliation", "running"] as const) {
      if ((await this.dependencies.store.list(scope, status, 1, undefined, "manual_check")).operations.length)
        throw new Error("The previous manual check is still unconfirmed. Wait for its result to be verified.");
    }
    const id = `manual-${this.dependencies.createId()}`;
    this.manualAdmissions.add(id);
    try {
      let admitted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.requireSession(session);
        const watermark = (await this.dependencies.store.watermark(scope))!;
        if (await this.dependencies.store.admit(scope, watermark.version, watermark, [{ operationId: id,
          admissionKey: id, trigger: "manual_check", configRevision: fresh.configRevision, snapshot: fresh,
          coverage: [], queuedAt: this.dependencies.now().toISOString(), status: "queued", attempts: 0, version: 0 }])) { admitted = true; break; }
      }
      if (!admitted) throw new Error("The execution queue changed. Try this check again.");
      const result: SchedulerRunResult = { leases: 1, pages: 0, saved: 0, failed: 0, skipped: null };
      await this.execute(session, scope, id, true, result);
      return result;
    } finally {
      this.manualAdmissions.delete(id);
      const pending = await this.dependencies.store.get(scope, id);
      if (pending?.status === "queued") await this.dependencies.store.transition(scope, id, pending.version,
        { status: "cancelled", cancellationReason: "manual_unavailable" });
    }
  }

  private async history(session: SchedulerSession, creator: CreatorRecord): Promise<ScheduleRevision[]> {
    const history: ScheduleRevision[] = [];
    let after = 0;
    for (;;) {
      await this.requireSession(session);
      const page = validateScheduleHistory(await this.dependencies.api.scheduleHistory(session.accessToken,
        creator.followId!, after, creator.configRevision), creator.followId!, after, creator.configRevision);
      history.push(...page.revisions);
      if (page.nextAfterRevision === null) return history;
      after = page.nextAfterRevision;
    }
  }

  private async pump(session: SchedulerSession, scope: OperationScope, result: SchedulerRunResult): Promise<void> {
    const delivery = this.deliver(session, scope, result);
    void delivery.catch(() => undefined);
    try {
      const work: Promise<void>[] = [];
      for (const status of ["queued", "waiting_continuation", "retry_pending", "requires_reconciliation", "running"] satisfies SourceStatus[]) {
        const key = JSON.stringify([scope, status]);
        const page = await this.dependencies.store.list(scope, status, 4, this.positions.get(key));
        if (page.next) this.positions.set(key, page.next); else this.positions.delete(key);
        while (this.positions.size > 128) this.positions.delete(this.positions.keys().next().value!);
        for (const operation of page.operations) {
          // A manual click positively unsent before a restart must not become an automatic click later.
          if (this.manualAdmissions.has(operation.operationId)) continue;
          if (operation.trigger === "manual_check" && operation.status === "queued") {
            await hostExecutionLocks.tryRun(["manual", scope.userId, scope.installationId, scope.creatorId], async () => {
              await this.dependencies.store.transition(scope, operation.operationId, operation.version,
                { status: "cancelled", cancellationReason: "manual_unavailable" });
            }, () => undefined);
            continue;
          }
          const execution = this.execute(session, scope, operation.operationId, operation.trigger === "manual_check", result);
          void execution.catch(() => undefined); // Later status-page reads must not leave an early rejection unobserved.
          work.push(execution);
        }
      }
      const settled = await Promise.allSettled(work);
      const failure = settled.find(item => item.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    } finally { await delivery; }
  }

  private execute(session: SchedulerSession, scope: OperationScope, id: string, manual: boolean,
    result: SchedulerRunResult): Promise<void> {
    const key = `indexed:source:${JSON.stringify(scope)}:${id}`;
    if (this.dependencies.requests.has(key)) {
      result.deferred = (result.deferred ?? 0) + 1;
      return Promise.resolve();
    }
    const deliveries: Promise<void>[] = [];
    const work = this.dependencies.requests.runExclusive(key, async () => {
      const operation = await this.dependencies.store.get(scope, id);
      if (operation) requireMatchingExecutionTarget(operation.snapshot.targetId, session.targetId);
      const executor = new SourceExecutor({ sharedDestinationReady: creator => this.dependencies.sharedDestinationReady?.(session,creator) ?? Promise.resolve(false), destinationAvailable: operation => this.dependencies.destinationAvailable?.(session, operation) ?? Promise.resolve(true), configurationReady: operation => this.dependencies.configurationReady?.(session, operation.snapshot.followId) ?? Promise.resolve(true), store: this.dependencies.store, api: {
        creatorUpdates: (...args) => this.dependencies.source(scope.creatorId, () => this.dependencies.api.creatorUpdates(...args),
          { ...scope, epoch: session.epoch, folderPath: args[1].saveFolderPath }),
        ...(this.dependencies.api.reportDestinationFailure ? {reportDestinationFailure: (token: string,input: Parameters<NonNullable<AgentLensApiPort["reportDestinationFailure"]>>[1]) => this.dependencies.api.reportDestinationFailure!(token,input)} : {}),
        getExecution: (...args) => this.dependencies.api.getExecution(...args),
        inspectExecutionRecovery: (...args) => this.dependencies.api.inspectExecutionRecovery(...args),
        resumeUnstartedExecution: (...args) => this.dependencies.api.resumeUnstartedExecution(...args)
      },
        createId: () => this.dependencies.createId(), now: () => this.dependencies.now(), context: async () => {
          await this.requireSession(session);
          const creators = await this.dependencies.api.listCreators(session.accessToken);
          await this.requireSession(session);
          return { ...session, online: true, creator: creators.find(item => item.creatorId === scope.creatorId) };
        } });
      for (let page = 0; page < 10; page++) {
          const task = () => executor.run(scope, id);
          const step = await (manual ? task() : hostExecutionLocks.tryRun(["source-lane", scope.installationId, String(this.lane++ % 4)], task, () => "deferred" as const));
          if (step === "failed") result.failed++;
          if (step === "deferred") result.deferred = (result.deferred ?? 0) + 1;
          if (step !== "page_saved") break;
          result.pages++;
          const delivery = this.deliver(session, scope, result);
          void delivery.catch(() => undefined);
          deliveries.push(delivery);
          if ((await this.dependencies.store.get(scope, id))?.status !== "waiting_continuation") break;
      }
    });
    return work.finally(async () => { await Promise.all(deliveries); });
  }

  private deliver(session: SchedulerSession, scope: OperationScope, result: SchedulerRunResult): Promise<void> {
    const key = JSON.stringify([scope.userId, scope.installationId, scope.creatorId]);
    const active = this.deliveryFlights.get(key);
    if (active) {
      active.requested = true;
      result.deferred = (result.deferred ?? 0) + 1;
      return Promise.resolve();
    }
    const flight = { requested: false };
    this.deliveryFlights.set(key, flight);
    return (async () => {
      try {
        do {
          flight.requested = false;
          await this.deliverBatch(session, scope, result);
        } while (flight.requested);
      } finally { this.deliveryFlights.delete(key); }
    })();
  }

  private deliverBatch(session: SchedulerSession, scope: OperationScope, result: SchedulerRunResult): Promise<void> {
    return hostExecutionLocks.run(["delivery", scope.userId, scope.installationId, scope.creatorId], async () => {
      for (const record of await this.dependencies.store.pendingDeliveries(scope, 8, this.dependencies.now().getTime())) {
        await this.requireSession(session);
        const target = record.snapshot;
        requireMatchingExecutionTarget(target.targetId, session.targetId);
        if (!target.noteTemplateId || !target.mediaPolicy) throw new Error("The saved destination is incomplete.");
        if (!await this.dependencies.store.beginPage(scope, record.operationId, record.pageNumber,
          record.attempts, this.dependencies.now().getTime(), record.itemKey)) continue;
        const attempt = record.attempts + 1;
        recordDiagnostic("delivery.started", scope, { creatorId: scope.creatorId, operationId: record.operationId,
          fetchId: record.page.fetchId, attempts: attempt });
        try {
          const saved = await this.dependencies.deliver(session.accessToken, record.page,
            { creatorId: scope.creatorId, leaseId: record.operationId, trigger: "continuation", saveFolderPath: target.saveFolderPath,
              noteTemplateId: target.noteTemplateId, mediaPolicy: target.mediaPolicy, schedulerState: "due", nextCheckAt: null }, record.sequence, attempt);
          await this.requireSession(session);
          if (saved.failures.length) {
            const mediaFailures = saved.failures.flatMap(item => item.mediaFailures ?? []);
            const stale = saved.failures.some(item => item.mediaFailures ? item.mediaFailures.some(media => media.kind === "source_expired") : /HTTP (?:401|403|404|410)\b|expired|download source is unavailable/i.test(item.error));
            await this.dependencies.store.failPage(scope, record.operationId, record.pageNumber, attempt, stale,
              saved.failures.some(item => item.code === "WRITE_REQUIRES_RECONCILIATION"), record.itemKey, mediaFailures);
          } else await this.dependencies.store.settlePage(scope, record.operationId, record.pageNumber, attempt, record.itemKey);
          recordDiagnostic("delivery.recorded", scope, { creatorId: scope.creatorId, operationId: record.operationId,
            fetchId: record.page.fetchId, attempts: attempt, result: saved.failures.length ? "incomplete" : "settled" });
          result.saved += saved.successes.length; result.failed += saved.failures.length;
        } catch (error) {
          recordDiagnostic("delivery.interrupted", scope, { creatorId: scope.creatorId, operationId: record.operationId,
            fetchId: record.page.fetchId, attempts: attempt });
          await this.dependencies.store.failPage(scope, record.operationId, record.pageNumber, attempt, false, true, record.itemKey);
          throw error;
        }
      }
      // Unknown writes verify their original attempt. Known failures may reuse another task’s
      // confirmed completion. Neither path grants another download attempt.
      for (const status of ["write_unknown", "needs_refetch", "retry_exhausted"] as const) {
        const positionKey = JSON.stringify([scope, status]);
        const unknown = await this.dependencies.store.pendingDeliveries(scope, 8, this.dependencies.now().getTime(), status, this.unknownPositions.get(positionKey));
        if (unknown.length === 8) {
          const last = unknown[7]!;
          this.unknownPositions.set(positionKey, { readyAt: last.readyAt, sequence: last.sequence, pageNumber: last.pageNumber, itemKey: last.itemKey });
        } else this.unknownPositions.delete(positionKey);
        while (this.unknownPositions.size > 128) this.unknownPositions.delete(this.unknownPositions.keys().next().value!);
        for (const record of unknown) {
          await this.requireSession(session);
          const target = record.snapshot;
          requireMatchingExecutionTarget(target.targetId, session.targetId);
          if (!target.noteTemplateId || !target.mediaPolicy) continue;
          try {
            const verified = await this.dependencies.deliver(session.accessToken, record.page,
              { creatorId: scope.creatorId, leaseId: record.operationId, trigger: "continuation", saveFolderPath: target.saveFolderPath,
                noteTemplateId: target.noteTemplateId, mediaPolicy: target.mediaPolicy, schedulerState: "due", nextCheckAt: null },
              record.sequence, record.attempts, status === "write_unknown" ? true : "reuse");
            await this.requireSession(session);
            if (verified.failures.length === 0) {
              await this.dependencies.store.settlePage(scope, record.operationId, record.pageNumber, record.attempts, record.itemKey);
              result.saved += verified.successes.length;
            } else result.deferred = (result.deferred ?? 0) + 1;
          } catch { result.deferred = (result.deferred ?? 0) + 1; }
        }
      }
    });
  }

  private scope(session: SchedulerSession, creator: CreatorRecord): OperationScope {
    return { userId: session.userId, installationId: session.installationId, creatorId: creator.creatorId };
  }
  private async requireSession(expected: SchedulerSession): Promise<void> {
    const current = await this.dependencies.session();
    if (!current || current.userId !== expected.userId || current.installationId !== expected.installationId
        || current.epoch !== expected.epoch || current.accessToken !== expected.accessToken || current.targetId !== expected.targetId)
      throw new Error("The account session changed; scheduler recovery is deferred.");
  }
}
