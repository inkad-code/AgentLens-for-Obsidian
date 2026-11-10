import { recordDiagnostic } from "../diagnostics/log";
import { mediaWriteResults } from "../workbench/writeResults";
import type { MediaPublicationIntent } from "../vault/MediaFingerprint";
import type { MediaFailureEvidence } from "../core/mediaFailure";
import type { CreatorLocalStatus } from "./creator-status";
import type { VaultWriteResult, NoteWriteManifest } from "../vault/VaultWriter";
import type { PersistedLedgerEntry } from "../core/domain";
import { contentKey } from "../core/domain";
import type { CreatorUpdatePage, WriteResultsRequest } from "../api/AgentLensApiClient";
import { persistedPost } from "../core/persistedPost";
import type { ScheduledCreator as CreatorSubscription } from "./types";
import type { OperationPlan } from "./types";
import type { SlotRange } from "./schedule-slots";
import { compareUtcTime } from "./schedule-slots";

export interface OperationScope { userId: string; installationId: string; creatorId: string }
export type SourceStatus = "queued" | "running" | "waiting_continuation" | "retry_pending"
  | "source_succeeded" | "failed" | "requires_reconciliation" | "cancelled";
export interface SourceOperation {
  pageNumber?: number | undefined;
  requestId?: string | undefined;
  operationId: string;
  admissionKey: string;
  trigger: "normal" | "catch_up" | "manual_check";
  configRevision: number;
  plan?: OperationPlan;
  /** The target and parser identity are frozen when this operation starts. */
  snapshot: CreatorSubscription;
  coverage: SlotRange[];
  scheduledAt?: string;
  queuedAt: string;
  sequence?: number;
  executionStartedAt?: string | undefined;
  dispatchedAt?: string | undefined;
  completedAt?: string | undefined;
  sourceCheckedAt?: string | undefined;
  status: SourceStatus;
  cursor?: string | undefined;
  attemptKey?: string | undefined;
  attempts: number;
  retryAt?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  cancellationReason?: "paused" | "configuration_changed" | "deleted" | "manual_unavailable";
  version: number;
}
export interface ScheduleWatermark {
  version: number;
  lastSequence?: number;
  configRevision: number;
  observedThrough: string;
  recoveryFrom?: string;
  recoveryEpoch?: string;
}
export interface OperationPage {
  operations: SourceOperation[];
  next?: { sequence: number };
}
export interface TaskHistoryItem {
  operationId: string; sequence: number; trigger: SourceOperation["trigger"];
  sourceStatus: SourceStatus; queuedAt: string; scheduledAt?: string | undefined;
  sourceCheckedAt?: string | undefined; completedAt?: string | undefined;
  attempts: number; configRevision: number;
  delivery: Record<DeliveryStatus, boolean>;
  statistics?: IndexedRunStatistics | undefined;
  deliveryCompletedAt?: string | undefined;
}
export interface TaskHistoryPage { items: TaskHistoryItem[]; next?: { sequence: number } }
export interface TaskDeliveryEvidence {
  pageNumber: number; fetchId: string; requestId: string | null; hasMore: boolean;
  coverageComplete: boolean; truncated: boolean;
  works: Array<{ contentKey: string; status: DeliveryStatus; attempts: number;
    media: Array<{ mediaId: string; status: DeliveryStatus; budgetAttempts: number; readyAt: number }> }>;
}
export interface TaskDetailPage {
  task: TaskHistoryItem; pages: TaskDeliveryEvidence[]; next?: { pageNumber: number };
  statistics?: IndexedRunStatistics | undefined; deliveryCompletedAt?: string | undefined;
}

export interface IndexedWriteIntent {
  recoveryId: string; manifest: NoteWriteManifest; preparedAt: string; completed: boolean;
  notePrepared?: boolean;
  mediaPublications?: Record<string, MediaPublicationIntent>;
}

export interface IndexedRunStatistics {
  fetchRunId: string; sequence: number; savedCount: number; reusedCount: number; savedAt?: string | undefined;
}
export interface IndexedCreatorStatistics {
  importedCount: number;
  lastSavedFetchRunId?: string;
  lastSavedRunSequence?: number;
  lastSavedCount?: number;
  lastSavedAt?: string;
}

export interface IndexedCallback {
  scope: OperationScope;
  idempotencyKey: string;
  request: WriteResultsRequest;
  status: "pending" | "acknowledged" | "requires_reconciliation";
  attempts: number;
  readyAt: number;
  version: number;
}

type DeliveryStatus = "pending" | "write_unknown" | "needs_refetch" | "retry_exhausted" | "settled";
interface DeliveryItem {
  mediaFailures?: readonly MediaFailureEvidence[];
  media?: Record<string, { status: DeliveryStatus; budgetAttempts: number; readyAt: number }>;
  status: DeliveryStatus; attempts: number; budgetAttempts: number; readyAt: number }
interface StoredDeliveryPage {
  key: string; scopeKey: string; operationId: string; sequence: number; pageNumber: number;
  snapshot: CreatorSubscription; page: CreatorUpdatePage; deliveryStatus: DeliveryStatus;
  readyAt: number; attempts: number; budgetAttempts: number;
  deliveryItems?: Record<string, DeliveryItem>;
  itemOperationKeys?: IDBValidKey[][];
  itemReadyKeys?: IDBValidKey[][];
  itemTargetKeys?: IDBValidKey[][];
}

type StoredOperation = SourceOperation & { key: string; scopeKey: string };
type OperationPatch = Partial<Pick<SourceOperation, "snapshot" | "status" | "cursor" | "attemptKey" | "attempts" | "retryAt"
  | "pageNumber" | "requestId" | "executionStartedAt" | "dispatchedAt" | "completedAt" | "errorCode" | "errorMessage" | "cancellationReason">>;

const transitions: Record<SourceStatus, ReadonlySet<SourceStatus>> = {
  queued: new Set(["running", "cancelled", "failed"]),
  running: new Set(["queued", "waiting_continuation", "retry_pending", "source_succeeded", "failed", "requires_reconciliation"]),
  waiting_continuation: new Set(["running"]),
  retry_pending: new Set(["running", "failed", "requires_reconciliation"]),
  requires_reconciliation: new Set(["waiting_continuation", "retry_pending", "source_succeeded", "failed"]),
  source_succeeded: new Set(), failed: new Set(), cancelled: new Set()
};

/** Per-operation storage: no whole-history JSON read or write on admission or completion. */
export class OperationStore {
  private static readonly listeners = new Map<string, Set<() => void>>();
  constructor(private readonly namespace: string, private readonly databaseName = "agentlens-obsidian-operations-v1") {}
  private listenerKey(): string { return JSON.stringify([this.databaseName, this.namespace]); }
  subscribe(listener: () => void): () => void {
    const listeners = OperationStore.listeners.get(this.listenerKey()) ?? new Set<() => void>();
    listeners.add(listener); OperationStore.listeners.set(this.listenerKey(), listeners);
    return () => { listeners.delete(listener); if (!listeners.size) OperationStore.listeners.delete(this.listenerKey()); };
  }
  private scopeKey(scope: OperationScope): string {
    if (!scope.userId || !scope.installationId || !scope.creatorId) throw new Error("Execution scope is incomplete.");
    return JSON.stringify([this.namespace, scope.userId, scope.installationId, scope.creatorId]);
  }
  private key(scope: OperationScope, operationId: string): string {
    return JSON.stringify([this.scopeKey(scope), operationId]);
  }
  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 15);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["writeReceipts", "runStatistics", "creatorStatistics", "localLedgers", "writeIntents", "creatorPresentation", "deliverySummaries"]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "key" });
        }
        const intents = typedStore(request.transaction!, "writeIntents");
        if (!intents.indexNames.contains("operationContent")) {
          intents.createIndex("operationContent", ["operationKey", "contentKey"]);
          const entries = intents.openCursor();
          entries.onsuccess = () => {
            const entry = entries.result;
            if (!entry) return;
            const [operationKey, contentKey] = JSON.parse(entry.value.key) as string[];
            entry.update({ ...entry.value, operationKey, contentKey }); entry.continue();
          };
        }
        if (!db.objectStoreNames.contains("callbacks")) {
          const callbacks = db.createObjectStore("callbacks", { keyPath: "key" });
          callbacks.createIndex("due", ["ownerKey", "status", "readyAt", "key"]);
        }
        const callbacks = typedStore(request.transaction!, "callbacks");
        if (!callbacks.indexNames.contains("creatorStatus"))
          callbacks.createIndex("creatorStatus", ["ownerKey", "scope.creatorId", "status"]);
        if (!db.objectStoreNames.contains("watermarks")) db.createObjectStore("watermarks", { keyPath: "scopeKey" });
        const watermarks = typedStore(request.transaction!, "watermarks");
        if (!watermarks.indexNames.contains("owner")) {
          watermarks.createIndex("owner", ["ownerKey", "creatorId"], { unique: true });
          const cursor = watermarks.openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            const [namespace, userId, installationId, creatorId] = JSON.parse(row.value.scopeKey) as string[];
            row.update({ ...row.value, ownerKey: JSON.stringify([namespace, userId, installationId]), creatorId });
            row.continue();
          };
        }
        if (!db.objectStoreNames.contains("pages")) {
          const pages = db.createObjectStore("pages", { keyPath: "key" });
          pages.createIndex("delivery", ["scopeKey", "deliveryStatus", "sequence", "pageNumber"], { unique: true });
        }
        if (!db.objectStoreNames.contains("deliverySources")) db.createObjectStore("deliverySources", { keyPath: "key" });
        if (!db.objectStoreNames.contains("repairLinks")) {
          const repairs = db.createObjectStore("repairLinks", { keyPath: "key" });
          repairs.createIndex("content", ["scopeKey", "postKey"]);
          repairs.createIndex("page", "pageKey");
        }
        const pageStore = typedStore(request.transaction!, "pages");
        if (!pageStore.indexNames.contains("itemOperation")) {
          pageStore.createIndex("itemOperation", "itemOperationKeys", { multiEntry: true });
          const cursor = pageStore.openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            row.update(this.deliveryProjection(row.value)); row.continue();
          };
        }
        if (!pageStore.indexNames.contains("operationPage"))
          pageStore.createIndex("operationPage", ["scopeKey", "operationId", "pageNumber"], { unique: true });
        if (!pageStore.indexNames.contains("operationWorks"))
          pageStore.createIndex("operationWorks", ["scopeKey", "operationId", "page.previews.length"]);
        if (!pageStore.indexNames.contains("operationStatus"))
          pageStore.createIndex("operationStatus", ["scopeKey", "operationId", "deliveryStatus", "pageNumber"]);
        if (!pageStore.indexNames.contains("operationFetch"))
          pageStore.createIndex("operationFetch", ["scopeKey", "operationId", "page.fetchId"], { unique: true });
        if (!pageStore.indexNames.contains("itemReady")) {
          pageStore.createIndex("itemReady", "itemReadyKeys", { multiEntry: true });
          pageStore.createIndex("itemTarget", "itemTargetKeys", { multiEntry: true });
          const cursor = pageStore.openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            row.update(this.deliveryProjection(row.value)); row.continue();
          };
        }
        if (!pageStore.indexNames.contains("targetStatus"))
          pageStore.createIndex("targetStatus", ["scopeKey", "snapshot.saveFolderPath", "deliveryStatus", "sequence"]);
        if (!pageStore.indexNames.contains("ready")) {
          pageStore.createIndex("ready", ["scopeKey", "deliveryStatus", "readyAt", "sequence", "pageNumber"]);
          const rows = pageStore.openCursor();
          rows.onsuccess = () => {
            const row = rows.result;
            if (!row) return;
            row.update(this.deliveryProjection({ ...row.value, readyAt: 0, attempts: 0 })); row.continue();
          };
        }
        const operations = db.objectStoreNames.contains("operations") ? typedStore(request.transaction!, "operations")
          : db.createObjectStore("operations", { keyPath: "key" }) as TypedStore<StoredOperation>;
        if (!operations.indexNames.contains("targetStatus")) {
          operations.createIndex("targetStatus", ["scopeKey", "snapshot.saveFolderPath", "status", "sequence"]);
          const rows = operations.openCursor();
          rows.onsuccess = () => {
            const row = rows.result;
            if (!row) return;
            this.projectSource(request.transaction!, row.value);
            row.continue();
          };
        }
        if (!operations.indexNames.contains("targetHistory"))
          operations.createIndex("targetHistory", ["scopeKey", "snapshot.saveFolderPath", "sequence"], { unique: true });
        if (!operations.indexNames.contains("admission")) operations.createIndex("admission", ["scopeKey", "admissionKey"], { unique: true });
        if (!operations.indexNames.contains("dispatch")) operations.createIndex("dispatch", ["scopeKey", "status", "sequence"]);
        if (!operations.indexNames.contains("trigger_dispatch"))
          operations.createIndex("trigger_dispatch", ["scopeKey", "trigger", "status", "sequence"]);
      };
      let blocked = false;
      request.onblocked = () => { blocked = true; reject(new Error("Execution storage upgrade is blocked.")); };
      request.onerror = () => reject(request.error ?? new Error("Execution storage failed."));
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else { request.result.onversionchange = () => request.result.close(); resolve(request.result); }
      };
    });
  }
  private async transaction<T>(stores: string[], mode: IDBTransactionMode,
    action: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode, { durability: "strict" });
        let value: T, failure: Error | undefined;
        tx.oncomplete = () => {
          resolve(value);
          if (mode === "readwrite") for (const listener of OperationStore.listeners.get(this.listenerKey()) ?? []) {
            try { listener(); } catch { /* Observers cannot invalidate an already committed transaction. */ }
          }
        };
        tx.onabort = () => reject(failure ?? tx.error ?? new Error("Execution transaction aborted."));
        tx.onerror = () => { /* The abort handler reports the durable transaction outcome. */ };
        const fail = (error: Error) => { failure = error; tx.abort(); };
        try { action(tx, result => { value = result; }, fail); }
        catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
    } finally { db.close(); }
  }
  async watermark(scope: OperationScope): Promise<ScheduleWatermark | undefined> {
    const scopeKey = this.scopeKey(scope);
    return this.transaction(["watermarks"], "readonly", (tx, result) => {
      const request = typedStore(tx, "watermarks").get(scopeKey);
      request.onsuccess = () => {
        const row = request.result;
        if (row) { const { scopeKey: _key, ownerKey: _owner, creatorId: _creator, ...watermark } = row; result(watermark); }
        else result(undefined);
      };
    });
  }
  /** Includes deleted bindings so their already-started work and deliveries remain recoverable. */
  async scopes(owner: Pick<OperationScope, "userId" | "installationId">, after?: string): Promise<{
    scopes: OperationScope[]; next?: string;
  }> {
    const ownerKey = JSON.stringify([this.namespace, owner.userId, owner.installationId]);
    const lower = after ? [ownerKey, after] : [ownerKey];
    return this.transaction(["watermarks"], "readonly", (tx, result) => {
      const read = typedStore(tx, "watermarks").index("owner")
        .getAll(IDBKeyRange.bound(lower, [ownerKey, []], Boolean(after)), 26);
      read.onsuccess = () => {
        const rows = read.result;
        const scopes = rows.slice(0, 25).map(row => ({ ...owner, creatorId: row.creatorId }));
        result({ scopes, ...(rows.length > 25 ? { next: scopes[24]!.creatorId } : {}) });
      };
    });
  }
  async get(scope: OperationScope, operationId: string): Promise<SourceOperation | undefined> {
    const key = this.key(scope, operationId);
    return this.transaction(["operations"], "readonly", (tx, result) => {
      const request = typedStore(tx, "operations").get(key);
      request.onsuccess = () => result(request.result ? this.publicOperation(request.result) : undefined);
    });
  }
  private publicOperation(row: StoredOperation): SourceOperation {
    const { key: _key, scopeKey: _scopeKey, ...operation } = row;
    return operation;
  }

  /** The expected version fences concurrent timer/online/window admissions. */
  async admit(scope: OperationScope, expectedVersion: number | undefined,
    next: Omit<ScheduleWatermark, "version">, operations: SourceOperation[]): Promise<boolean> {
    const scopeKey = this.scopeKey(scope);
    if (operations.length > 100) throw new Error("Admission must be split into bounded batches.");
    compareUtcTime(next.observedThrough, next.observedThrough);
    for (const operation of operations) {
      compareUtcTime(operation.queuedAt, operation.queuedAt);
      if (operation.snapshot.creatorId !== scope.creatorId || !operation.operationId || !operation.admissionKey
          || operation.status !== "queued" || operation.version !== 0 || operation.executionStartedAt
          || operation.attempts !== 0 || !Number.isSafeInteger(operation.configRevision) || operation.configRevision < 1
          || operation.snapshot.configRevision !== undefined && operation.snapshot.configRevision !== operation.configRevision)
        throw new Error("Invalid new operation.");
    }
    const admitted = await this.transaction<boolean>(["watermarks", "operations"], "readwrite", (tx, result, fail) => {
      const watermarks = typedStore(tx, "watermarks"), tasks = typedStore(tx, "operations");
      const read = watermarks.get(scopeKey);
      read.onsuccess = () => {
        const previous = read.result as (ScheduleWatermark & { scopeKey: string }) | undefined;
        if (previous?.version !== expectedVersion) { result(false); return; }
        try {
          if (!Number.isSafeInteger(next.configRevision) || next.configRevision < 1 || previous
              && (compareUtcTime(next.observedThrough, previous.observedThrough) < 0 || next.configRevision < previous.configRevision))
            throw new Error("Schedule watermarks cannot move backwards.");
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); return; }
        let sequence = previous?.lastSequence ?? next.lastSequence ?? 0;
        if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence + operations.length > Number.MAX_SAFE_INTEGER) {
          fail(new Error("Execution sequence is invalid.")); return;
        }
        for (const operation of operations) {
          // A duplicate admission aborts both writes, preserving the old waterline.
          tasks.add({ ...operation, sequence: ++sequence, scopeKey, key: this.key(scope, operation.operationId) } satisfies StoredOperation);
        }
        watermarks.put({ ...next,
          lastSequence: sequence, scopeKey,
          ownerKey: JSON.stringify([this.namespace, scope.userId, scope.installationId]), creatorId: scope.creatorId,
          version: (expectedVersion ?? -1) + 1 });
        result(true);
      };
    });
    if (admitted) for (const operation of operations) recordDiagnostic("operation.admitted", scope, {
      creatorId: scope.creatorId, operationId: operation.operationId, trigger: operation.trigger,
      scheduledAt: operation.scheduledAt, queuedAt: operation.queuedAt, configRevision: operation.configRevision,
    });
    return admitted;
  }

  async list(scope: OperationScope, status: SourceStatus, limit = 25,
    after?: { sequence: number }, trigger?: SourceOperation["trigger"]): Promise<OperationPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid execution page size.");
    const scopeKey = this.scopeKey(scope);
    const prefix = trigger ? [scopeKey, trigger, status] : [scopeKey, status];
    const lower = after ? [...prefix, after.sequence] : prefix;
    const range = IDBKeyRange.bound(lower, [...prefix, []], Boolean(after), false);
    return this.transaction(["operations"], "readonly", (tx, result) => {
      const request = typedStore(tx, "operations").index(trigger ? "trigger_dispatch" : "dispatch").openCursor(range);
      const rows: SourceOperation[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { result({ operations: rows }); return; }
        if (rows.length === limit) {
          const last = rows[rows.length - 1];
          result({ operations: rows, next: { sequence: last!.sequence! } }); return;
        }
        rows.push(this.publicOperation(cursor.value)); cursor.continue();
      };
    });
  }

  private taskHistoryItem(operation: SourceOperation): TaskHistoryItem {
    return { operationId: operation.operationId, sequence: operation.sequence!, trigger: operation.trigger,
      sourceStatus: operation.status, queuedAt: operation.queuedAt, scheduledAt: operation.scheduledAt,
      sourceCheckedAt: operation.sourceCheckedAt, completedAt: operation.completedAt,
      attempts: operation.attempts, configRevision: operation.configRevision,
      delivery: { pending: false, write_unknown: false, needs_refetch: false, retry_exhausted: false, settled: false } };
  }

  /** Fixed index probes cover every work, including evidence outside the loaded detail page. */
  private readTaskFacts(tx: IDBTransaction, scope: OperationScope, item: TaskHistoryItem): void {
    const key = this.key(scope, item.operationId);
    for (const status of Object.keys(item.delivery) as DeliveryStatus[]) {
      const read = typedStore(tx, "pages").index("itemOperation").getKey([this.scopeKey(scope), item.operationId, status]);
      read.onsuccess = () => { item.delivery[status] = read.result !== undefined; };
    }
    const statistics = typedStore(tx, "runStatistics").get(key);
    statistics.onsuccess = () => {
      if (!statistics.result) return;
      const { fetchRunId, sequence, savedCount, reusedCount, savedAt } = statistics.result;
      item.statistics = { fetchRunId, sequence, savedCount, reusedCount, savedAt };
    };
    const summary = typedStore(tx, "deliverySummaries").get(key);
    summary.onsuccess = () => { item.deliveryCompletedAt = summary.result?.completedAt; };
  }

  /** Newest first; the cursor stays stable when new tasks arrive or old task statuses change. */
  async taskHistory(scope: OperationScope, folderPath: string, limit = 25,
    after?: { sequence: number }): Promise<TaskHistoryPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100
        || after && (!Number.isSafeInteger(after.sequence) || after.sequence < 1)) throw new Error("Invalid history page.");
    const prefix = [this.scopeKey(scope), folderPath];
    return this.transaction(["operations", "pages", "runStatistics", "deliverySummaries"], "readonly", (tx, result) => {
      const read = typedStore(tx, "operations").index("targetHistory").openCursor(
        IDBKeyRange.bound(prefix, [...prefix, after?.sequence ?? []], false, Boolean(after)), "prev");
      const items: TaskHistoryItem[] = [];
      read.onsuccess = () => {
        const cursor = read.result;
        if (!cursor) { result({ items }); return; }
        if (items.length === limit) { result({ items, next: { sequence: items[items.length - 1]!.sequence } }); return; }
        const item = this.taskHistoryItem(cursor.value);
        this.readTaskFacts(tx, scope, item); items.push(item); cursor.continue();
      };
    });
  }

  async taskSummary(scope: OperationScope, operationId: string): Promise<TaskHistoryItem | undefined> {
    return this.transaction(["operations", "pages", "runStatistics", "deliverySummaries"], "readonly", (tx, result) => {
      const read = typedStore(tx, "operations").get(this.key(scope, operationId));
      read.onsuccess = () => {
        if (!read.result) { result(undefined); return; }
        const item = this.taskHistoryItem(read.result);
        this.readTaskFacts(tx, scope, item); result(item);
      };
    });
  }

  async callbackDiagnostics(owner: Pick<OperationScope, "userId" | "installationId">, status: IndexedCallback["status"]) {
    const prefix = [JSON.stringify([this.namespace, owner.userId, owner.installationId]), status];
    return this.transaction<{ items: Array<{ creatorId: string; operationId: string; status: IndexedCallback["status"]; attempts: number; readyAt: number }>; truncated: boolean }>(["callbacks"], "readonly", (tx, result) => {
      const read = typedStore(tx, "callbacks").index("due").getAll(IDBKeyRange.bound(prefix, [...prefix, []]), 26);
      read.onsuccess = () => result({ items: read.result.slice(0, 25).map(row => ({ creatorId: row.scope.creatorId,
        operationId: row.request.fetchRunId ?? row.request.runId, status: row.status, attempts: row.attempts, readyAt: row.readyAt })), truncated: read.result.length > 25 });
    });
  }

  /** One consistent read of bounded public evidence; never loads private recovery sources. */
  async taskDetail(scope: OperationScope, folderPath: string, operationId: string, limit = 10,
    after?: { pageNumber: number }): Promise<TaskDetailPage | undefined> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100
        || after && (!Number.isSafeInteger(after.pageNumber) || after.pageNumber < 1)) throw new Error("Invalid detail page.");
    return this.transaction(["operations", "pages", "runStatistics", "deliverySummaries"], "readonly", (tx, result) => {
      const key = this.key(scope, operationId), operation = typedStore(tx, "operations").get(key);
      operation.onsuccess = () => {
        if (!operation.result || operation.result.snapshot.saveFolderPath !== folderPath) { result(undefined); return; }
        const detail: TaskDetailPage = { task: this.taskHistoryItem(operation.result), pages: [] };
        result(detail);
        this.readTaskFacts(tx, scope, detail.task);
        const statistics = typedStore(tx, "runStatistics").get(key);
        statistics.onsuccess = () => {
          if (!statistics.result) return;
          const { fetchRunId, sequence, savedCount, reusedCount, savedAt } = statistics.result;
          detail.statistics = { fetchRunId, sequence, savedCount, reusedCount, savedAt };
        };
        const summary = typedStore(tx, "deliverySummaries").get(key);
        summary.onsuccess = () => { detail.deliveryCompletedAt = summary.result?.completedAt; };
        const prefix = [this.scopeKey(scope), operationId];
        const pages = typedStore(tx, "pages").index("operationPage").openCursor(
          IDBKeyRange.bound(after ? [...prefix, after.pageNumber] : prefix, [...prefix, []], Boolean(after), false));
        pages.onsuccess = () => {
          const cursor = pages.result;
          if (!cursor) return;
          if (detail.pages.length === limit) { detail.next = { pageNumber: detail.pages[detail.pages.length - 1]!.pageNumber }; return; }
          const row = this.deliveryProjection(cursor.value);
          detail.pages.push({ pageNumber: row.pageNumber, fetchId: row.page.fetchId, requestId: row.page.requestId,
            hasMore: row.page.hasMore, coverageComplete: row.page.coverageComplete, truncated: row.page.truncated,
            works: Object.entries(row.deliveryItems!).filter(([contentKey]) => Boolean(contentKey)).map(([contentKey, item]) => ({
              contentKey, status: item.status, attempts: item.attempts,
              media: Object.entries(item.media ?? {}).map(([mediaId, state]) => ({ mediaId, ...state,
                status: item.status === "settled" ? "settled" : state.status })) })) });
          cursor.continue();
        };
      };
    });
  }

  /** Page evidence and source progress commit together; failed persistence advances neither. */
  async acceptPage(scope: OperationScope, operationId: string, expectedVersion: number,
    page: CreatorUpdatePage, completedAt: string): Promise<SourceOperation | undefined> {
    const scopeKey = this.scopeKey(scope), key = this.key(scope, operationId);
    const retainedPage = { ...page, previews: page.previews.map(persistedPost) };
    return this.transaction(["operations", "pages", "deliverySources", "repairLinks", "creatorPresentation"], "readwrite", (tx, result, fail) => {
      const tasks = typedStore(tx, "operations"), read = tasks.get(key);
      read.onsuccess = () => {
        const operation = read.result;
        if (!operation || operation.version !== expectedVersion) { result(undefined); return; }
        if (operation.sequence === undefined || operation.status !== "running" || page.fetchRunId !== operationId || page.creatorId !== scope.creatorId
            || !page.fetchId || page.hasMore && (!page.cursor || page.cursor === operation.cursor)) {
          fail(new Error("The source page does not match its persisted operation.")); return;
        }
        const pageNumber = operation.pageNumber ?? 1;
        const incomplete = page.truncated || !page.hasMore && !page.coverageComplete;
        const pageKey = JSON.stringify([key, pageNumber]);
        // Recovery input is private to this account/installation/task. History stays redacted.
        typedStore(tx, "deliverySources").add({ key: pageKey, previews: page.previews });
        typedStore(tx, "pages").add(this.deliveryProjection({ key: pageKey, scopeKey, operationId,
          sequence: operation.sequence, pageNumber, snapshot: operation.snapshot,
          deliveryStatus: "pending", readyAt: 0, attempts: 0, budgetAttempts: 0, page: { ...retainedPage, leaseId: operationId,
            requestId: retainedPage.requestId ?? operation.requestId ?? null } }));
        const updated: StoredOperation = { ...operation, version: operation.version + 1,
          status: incomplete ? "failed" : page.hasMore ? "waiting_continuation" : "source_succeeded",
          cursor: page.hasMore ? page.cursor! : undefined,
          pageNumber: page.hasMore ? pageNumber + 1 : pageNumber,
          requestId: undefined, attemptKey: undefined, retryAt: undefined,
          completedAt: page.hasMore && !incomplete ? undefined : completedAt,
          sourceCheckedAt: !incomplete && !page.hasMore ? page.serverCheckedAt : undefined,
          errorCode: incomplete ? "AUTO_FETCH_COVERAGE_INCOMPLETE" : undefined };
        if (operation.trigger !== "manual_check") this.repairPages(tx, scopeKey, page, operation.snapshot);
        tasks.put(updated); this.projectSource(tx, updated); result(this.publicOperation(updated));
      };
    });
  }

  /** Refresh matching transport data without changing an admitted work manifest. */
  private repairPages(tx: IDBTransaction, scopeKey: string, fresh: CreatorUpdatePage, target: CreatorSubscription): void {
    const posts = new Map(fresh.previews.map(post => [contentKey(post), post]));
    let remaining = posts.size;
    const pageKeys = new Set<string>();
    const repairs = typedStore(tx, "repairLinks");
    for (const postKey of posts.keys()) {
      const links = repairs.index("content").openCursor(IDBKeyRange.only([scopeKey, postKey]));
      links.onsuccess = () => {
        const cursor = links.result;
        if (cursor) { pageKeys.add(cursor.value.pageKey); cursor.continue(); return; }
        if (--remaining !== 0) return;
        for (const pageKey of pageKeys) {
          const read = typedStore(tx, "pages").get(pageKey);
          read.onsuccess = () => {
            if (!read.result) return;
            const old = this.deliveryProjection(read.result);
            if (old.snapshot.saveFolderPath !== target.saveFolderPath || old.snapshot.noteTemplateId !== target.noteTemplateId
                || old.snapshot.mediaPolicy !== target.mediaPolicy) return;
            const repaired = new Set(Object.entries(old.deliveryItems!).filter(([key, item]) => item.status !== "write_unknown" && item.status !== "settled" && (item.status === "needs_refetch" || Object.values(item.media ?? {}).some(media => media.status === "needs_refetch")) && posts.has(key)).map(([key]) => key));
            if (!repaired.size) return;
            const source = typedStore(tx, "deliverySources").get(pageKey);
            source.onsuccess = () => {
              const previews = (source.result?.previews ?? old.page.previews).map((previous: CreatorUpdatePage["previews"][number]) => {
                const postKey = contentKey(previous);
                if (!repaired.has(postKey)) return previous;
                const item = old.deliveryItems![postKey]!;
                const freshMedia = posts.get(postKey)!.media;
                const matched = new Set<string>();
                const media = previous.media.map(original => {
                  const candidates = freshMedia.filter(candidate => candidate.id === original.id && candidate.kind === original.kind);
                  if (candidates.length !== 1 || !candidates[0]!.sourceUrl) return original;
                  const replacement = candidates[0]!;
                  matched.add(original.id);
                  return { ...original, sourceUrl: replacement.sourceUrl, downloadHeaders: replacement.downloadHeaders,
                    downloadUrlExpiresAt: replacement.downloadUrlExpiresAt };
                });
                if (item.media) {
                  for (const [id, state] of Object.entries(item.media)) {
                    if (state.status === "needs_refetch" && matched.has(id))
                      Object.assign(state, { status: "pending", budgetAttempts: 0, readyAt: 0 });
                  }
                  item.status = Object.values(item.media).some(state => state.status === "pending") ? "pending"
                    : Object.values(item.media).some(state => state.status === "needs_refetch") ? "needs_refetch" : "retry_exhausted";
                  item.readyAt = Math.min(...Object.values(item.media).filter(state => state.status === item.status).map(state => state.readyAt));
                  if (!Object.values(item.media).some(state => state.status === "needs_refetch")) repairs.delete(JSON.stringify([pageKey, postKey]));
                } else if (previous.media.length > 0 && previous.media.every(original => matched.has(original.id))) {
                  Object.assign(item, { status: "pending", readyAt: 0, budgetAttempts: 0 });
                  repairs.delete(JSON.stringify([pageKey, postKey]));
                }
                return { ...previous, media };
              });
              typedStore(tx, "deliverySources").put({ key: pageKey, previews });
              typedStore(tx, "pages").put(this.deliveryProjection({ ...old, page: { ...old.page, previews: previews.map(persistedPost) } }));
            };
          };
        }
      };
    }
  }

  private deliveryProjection(row: StoredDeliveryPage): StoredDeliveryPage {
    const items: Record<string, DeliveryItem> = row.deliveryItems ?? Object.fromEntries((row.page.previews.length ? row.page.previews.map(contentKey) : [""])
      .map(key => [key, { status: row.deliveryStatus, readyAt: row.readyAt ?? 0, attempts: row.attempts ?? 0,
        budgetAttempts: row.budgetAttempts ?? row.attempts ?? 0 }]));
    const values = Object.values(items);
    const status = (["pending", "write_unknown", "needs_refetch", "retry_exhausted", "settled"] as const)
      .find(status => values.some(item => item.status === status)) ?? "settled";
    return { ...row, deliveryItems: items, deliveryStatus: status,
      attempts: Math.max(0, ...values.map(item => item.attempts)),
      readyAt: Math.min(...values.filter(item => item.status === status).map(item => item.readyAt)),
      itemOperationKeys: [...new Set(values.flatMap(item => [item.status,
        ...Object.values(item.status === "settled" ? {} : item.media ?? {}).map(media => media.status)]))].map(status => [row.scopeKey, row.operationId, status]),
      itemReadyKeys: Object.entries(items).map(([key, item]) => [row.scopeKey, item.status, item.readyAt, row.sequence, row.pageNumber, key]),
      itemTargetKeys: Object.entries(items).flatMap(([key, item]) => [...new Set([item.status,
        ...Object.values(item.status === "settled" ? {} : item.media ?? {}).filter(media => media.status === "needs_refetch" || media.status === "retry_exhausted").map(media => media.status)])]
        .map(status => [row.scopeKey, row.snapshot.saveFolderPath, status, row.sequence, row.pageNumber, key])) };
  }

  /** Index entries address individual works without scanning or duplicating their source page. */
  async pendingDeliveries(scope: OperationScope, limit = 8, now = Number.MAX_SAFE_INTEGER,
    status: Exclude<DeliveryStatus, "settled"> = "pending", after?: { readyAt: number; sequence: number; pageNumber: number; itemKey?: string }) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid delivery page size.");
    const prefix = [this.scopeKey(scope), status];
    const lower = after ? [...prefix, after.readyAt, after.sequence, after.pageNumber, after.itemKey ?? ""] : prefix;
    return this.transaction<Array<{ operationId: string; sequence: number; pageNumber: number; snapshot: CreatorSubscription;
      page: CreatorUpdatePage; attempts: number; readyAt: number; itemKey: string; mediaFailures?: readonly MediaFailureEvidence[] }>>(["pages", "deliverySources"], "readonly", (tx, result) => {
      const rows: Array<{ operationId: string; sequence: number; pageNumber: number; snapshot: CreatorSubscription;
        page: CreatorUpdatePage; attempts: number; readyAt: number; itemKey: string; mediaFailures?: readonly MediaFailureEvidence[] }> = [];
      if (after && after.readyAt > now) { result(rows); return; }
      const cursor = typedStore(tx, "pages").index("itemReady").openCursor(IDBKeyRange.bound(lower, [...prefix, now, []], Boolean(after)));
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry || rows.length === limit) { result(rows); return; }
        const row = entry.value, itemKey = (entry.key as IDBValidKey[])[5] as string;
        const item = row.deliveryItems![itemKey]!;
        const source = typedStore(tx, "deliverySources").get(row.key);
        source.onsuccess = () => {
          const previews = (source.result?.previews ?? row.page.previews);
          rows.push({ operationId: row.operationId, sequence: row.sequence, pageNumber: row.pageNumber, snapshot: row.snapshot,
            attempts: item.attempts, readyAt: item.readyAt, itemKey,
            ...(item.mediaFailures ? { mediaFailures: item.mediaFailures } : {}),
            page: { ...row.page, previews: previews.filter(post => contentKey(post) === itemKey),
              deliveryItemKey: itemKey, deliveryItemCount: row.page.previews.length,
              ...(item.media ? { deliveryDeferredMedia: Object.entries(item.media)
                .filter(([, media]) => media.status !== "pending" || media.readyAt > now)
                .map(([mediaId, media]) => ({ mediaId, kind: media.status === "needs_refetch" ? "source_expired" as const : "retryable" as const, deferred: true })) } : {}) } });
          cursor.result!.continue();
        };
      };
    });
  }

  async pendingPages(scope: OperationScope, limit = 8, now = Number.MAX_SAFE_INTEGER, status: "pending" | "write_unknown" | "needs_refetch" | "retry_exhausted" = "pending",
    after?: { readyAt: number; sequence: number; pageNumber: number }): Promise<Array<{
    operationId: string; sequence: number; pageNumber: number; snapshot: CreatorSubscription; page: CreatorUpdatePage; attempts: number; readyAt: number;
  }>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid delivery page size.");
    const prefix = [this.scopeKey(scope), status];
    if (after && after.readyAt > now) return [];
    const lower = after ? [...prefix, after.readyAt, after.sequence, after.pageNumber] : prefix;
    return this.transaction(["pages", "deliverySources"], "readonly", (tx, result) => {
      const read = typedStore(tx, "pages").index("ready").getAll(IDBKeyRange.bound(lower, [...prefix, now, []], Boolean(after)), limit);
      read.onsuccess = () => {
        const rows = read.result.map(({ operationId, sequence, pageNumber, snapshot, page, attempts, readyAt }) =>
          ({ operationId, sequence, pageNumber, snapshot, page, attempts: attempts ?? 0, readyAt }));
        let remaining = rows.length;
        if (!remaining) { result(rows); return; }
        rows.forEach((row, index) => {
          const source = typedStore(tx, "deliverySources").get(read.result[index]!.key);
          source.onsuccess = () => {
            if (source.result) row.page = { ...row.page, previews: source.result.previews };
            if (--remaining === 0) result(rows);
          };
        });
      };
    });
  }

  /** Persist each work's retry budget before touching the Vault. */
  async beginPage(scope: OperationScope, operationId: string, pageNumber: number, attempts: number, now: number, itemKey?: string): Promise<boolean> {
    const key = JSON.stringify([this.key(scope, operationId), pageNumber]);
    return this.transaction(["pages"], "readwrite", (tx, result) => {
      const pages = typedStore(tx, "pages"), read = pages.get(key);
      read.onsuccess = () => {
        if (!read.result) { result(false); return; }
        const row = this.deliveryProjection(read.result);
        const items = itemKey === undefined ? Object.values(row.deliveryItems!) : [row.deliveryItems![itemKey]].filter(item => item !== undefined);
        if (!items.length || items.some(item => item.status !== "pending" || item.attempts !== attempts || item.readyAt > now)) { result(false); return; }
        if (items.some(item => !item.media && item.budgetAttempts >= 6)) {
          for (const item of items) if (!item.media && item.budgetAttempts >= 6) item.status = "write_unknown";
          pages.put(this.deliveryProjection(row)); result(false); return;
        }
        if (items.some(item => Object.values(item.media ?? {}).some(media => media.status === "pending" && media.readyAt <= now && media.budgetAttempts >= 6))) {
          for (const item of items) if (Object.values(item.media ?? {}).some(media => media.status === "pending" && media.readyAt <= now && media.budgetAttempts >= 6)) item.status = "write_unknown";
          pages.put(this.deliveryProjection(row)); result(false); return;
        }
        for (const item of items) {
          item.attempts++; item.budgetAttempts++; item.readyAt = now + 300_000;
          if (item.media) for (const media of Object.values(item.media)) {
            if (media.status === "pending" && media.readyAt <= now) {
              media.budgetAttempts++; media.readyAt = item.readyAt;
            }
          }
        }
        pages.put(this.deliveryProjection(row)); result(true);
      };
    });
  }

  async failPage(scope: OperationScope, operationId: string, pageNumber: number, attempts: number,
    needsRefetch: boolean, writeUnknown = false, itemKey?: string, mediaFailures?: readonly MediaFailureEvidence[]): Promise<void> {
    const key = JSON.stringify([this.key(scope, operationId), pageNumber]);
    return this.transaction(["pages", "repairLinks"], "readwrite", (tx, result) => {
      const pages = typedStore(tx, "pages"), read = pages.get(key);
      read.onsuccess = () => {
        if (read.result) {
          const row = this.deliveryProjection(read.result);
          for (const [postKey, item] of Object.entries(row.deliveryItems!)) {
            if (itemKey !== undefined && itemKey !== postKey || item.attempts !== attempts || item.status !== "pending") continue;
            if (mediaFailures?.length) item.mediaFailures = mediaFailures;
            item.status = writeUnknown ? "write_unknown" : needsRefetch ? "needs_refetch" : item.budgetAttempts >= 6 ? "retry_exhausted" : "pending";
            if (mediaFailures?.length && !writeUnknown) {
              const previous = item.media ?? {};
              item.media = Object.fromEntries(mediaFailures.map(failure => {
                const media = previous[failure.mediaId] ?? { status: "pending" as DeliveryStatus, budgetAttempts: 1, readyAt: item.readyAt };
                if (!failure.deferred) media.status = failure.kind === "source_expired" ? "needs_refetch"
                  : media.budgetAttempts >= 6 ? "retry_exhausted" : "pending";
                return [failure.mediaId, media];
              }));
              item.status = Object.values(item.media).some(media => media.status === "pending") ? "pending"
                : Object.values(item.media).some(media => media.status === "needs_refetch") ? "needs_refetch" : "retry_exhausted";
              item.readyAt = Math.min(...Object.values(item.media).filter(media => media.status === item.status).map(media => media.readyAt));
            }
            if (item.status === "needs_refetch" || Object.values(item.media ?? {}).some(media => media.status === "needs_refetch")) typedStore(tx, "repairLinks").put({ key: JSON.stringify([key, postKey]), pageKey: key, scopeKey: this.scopeKey(scope), postKey });
          }
          pages.put(this.deliveryProjection(row));
        }
        result(undefined);
      };
    });
  }

  /** Only the final confirmed work releases the page's private recovery source. */
  async settlePage(scope: OperationScope, operationId: string, pageNumber: number, attempts?: number, itemKey?: string): Promise<void> {
    const key = JSON.stringify([this.key(scope, operationId), pageNumber]);
    return this.transaction(["operations", "pages", "deliverySources", "repairLinks", "deliverySummaries", "callbacks"], "readwrite", (tx, result, fail) => {
      const pages = typedStore(tx, "pages"), read = pages.get(key);
      read.onsuccess = () => {
        if (read.result) {
          const row = this.deliveryProjection(read.result);
          for (const [postKey, item] of Object.entries(row.deliveryItems!)) {
            if (itemKey !== undefined && postKey !== itemKey || attempts !== undefined && item.attempts !== attempts) continue;
            item.status = "settled";
            typedStore(tx, "repairLinks").delete(JSON.stringify([key, postKey]));
          }
          const projected = this.deliveryProjection(row);
          pages.put(projected);
          if (projected.deliveryStatus === "settled") typedStore(tx, "deliverySources").delete(key);
          this.completeDelivery(tx, scope, operationId, fail);
        }
        result(undefined);
      };
    });
  }

  /** Final delivery completion uses indexed existence checks, not an unbounded page scan. */
  private completeDelivery(tx: IDBTransaction, scope: OperationScope, operationId: string, fail: (error: Error) => void): void {
    const runKey = this.key(scope, operationId), scopeKey = this.scopeKey(scope);
    const source = typedStore(tx, "operations").get(runKey);
    source.onsuccess = () => {
      if (source.result?.status !== "source_succeeded") return;
      let remaining = 4, unfinished = false;
      for (const status of ["pending", "write_unknown", "needs_refetch", "retry_exhausted"]) {
        const prefix = [scopeKey, operationId, status];
        const exists = typedStore(tx, "pages").index("operationStatus").getKey(IDBKeyRange.bound(prefix, [...prefix, []]));
        exists.onsuccess = () => {
          unfinished ||= exists.result !== undefined;
          if (--remaining || unfinished) return;
          const summaries = typedStore(tx, "deliverySummaries"), summary = summaries.get(runKey);
          summary.onsuccess = () => {
            if (summary.result?.completedAt) return;
            const finalPage = typedStore(tx, "pages").get(JSON.stringify([runKey, source.result!.pageNumber ?? 1]));
            finalPage.onsuccess = () => {
              if (!finalPage.result || finalPage.result.deliveryStatus !== "settled" || finalPage.result.page.hasMore) return;
              try {
                const prior = summary.result;
                // Empty runs have no note receipt to submit; their source result already records no_update.
                // Otherwise repeat one immutable successful note receipt with the final source coverage.
                if (!prior?.request) {
                  const prefix = [scopeKey, operationId];
                  const works = typedStore(tx, "pages").index("operationWorks").getKey(IDBKeyRange.bound([...prefix, 1], [...prefix, []]));
                  works.onsuccess = () => {
                    if (works.result === undefined) summaries.put({ key: runKey, completedAt: new Date().toISOString() });
                  };
                  return;
                }
                {
                  const page = finalPage.result.page;
                  const request: WriteResultsRequest = { ...prior.request, runComplete: true,
                    coverageComplete: page.coverageComplete, truncated: page.truncated, stopReason: page.stopReason ?? undefined };
                  const idempotencyKey = `delivery-complete-${operationId}`;
                  typedStore(tx, "callbacks").add({ key: this.key(scope, idempotencyKey),
                    ownerKey: JSON.stringify([this.namespace, scope.userId, scope.installationId]), scope, idempotencyKey, request,
                    status: "pending", attempts: 0, readyAt: 0, version: 0 });
                }
                summaries.put({ ...prior, key: runKey, completedAt: new Date().toISOString() });
              } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
            };
          };
        };
      }
    };
  }

  async deliveryCompletion(scope: OperationScope, operationId: string): Promise<{ completedAt?: string } | undefined> {
    const row = await this.readSummary<{ completedAt?: string }>("deliverySummaries", this.key(scope, operationId));
    return row?.completedAt ? { completedAt: row.completedAt } : undefined;
  }

  async prepareWrite(scope: OperationScope, operationId: string, manifest: NoteWriteManifest): Promise<IndexedWriteIntent> {
    const key = JSON.stringify([this.key(scope, operationId), manifest.contentKey, manifest.notePath]);
    return this.transaction(["writeIntents"], "readwrite", (tx, result) => {
      const intents = typedStore(tx, "writeIntents"), read = intents.get(key);
      read.onsuccess = () => {
        if (read.result && !read.result.completed) {
          const { key: _key, operationKey: _operation, contentKey: _content, ...intent } = read.result; result(intent); return;
        }
        const intent: IndexedWriteIntent = { recoveryId: crypto.randomUUID(), manifest,
          preparedAt: new Date().toISOString(), completed: false, notePrepared: false };
        intents.put({ ...intent, key, operationKey: this.key(scope, operationId), contentKey: manifest.contentKey }); result(intent);
      };
    });
  }

  async markNotePrepared(scope: OperationScope, operationId: string, contentKey: string, notePath: string, recoveryId: string): Promise<void> {
    const key = JSON.stringify([this.key(scope, operationId), contentKey, notePath]);
    return this.transaction(["writeIntents"], "readwrite", (tx, result, fail) => {
      const store = typedStore(tx, "writeIntents"), read = store.get(key);
      read.onsuccess = () => {
        if (!read.result || read.result.completed || read.result.recoveryId !== recoveryId) {
          fail(new Error("Note preparation does not match its original write intent.")); return;
        }
        store.put({ ...read.result, notePrepared: true }); result(undefined);
      };
    });
  }

  async prepareMediaPublication(scope: OperationScope, operationId: string, contentKey: string,
    notePath: string, recoveryId: string, evidence: MediaPublicationIntent): Promise<void> {
    if (!Number.isSafeInteger(evidence.sizeBytes) || evidence.sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(evidence.sha256))
      throw new Error("Invalid attachment byte evidence.");
    const key = JSON.stringify([this.key(scope, operationId), contentKey, notePath]);
    return this.transaction(["writeIntents"], "readwrite", (tx, result, fail) => {
      const intents = typedStore(tx, "writeIntents"), read = intents.get(key);
      read.onsuccess = () => {
        const intent = read.result as IndexedWriteIntent | undefined;
        if (!intent || intent.completed || intent.recoveryId !== recoveryId
            || !intent.manifest.attachments.some(item => item.mediaId === evidence.mediaId && item.path === evidence.path && item.action === "new")) {
          fail(new Error("Attachment publication does not match its original write intent.")); return;
        }
        const previous = intent.mediaPublications?.[evidence.mediaId];
        if (previous && (previous.path !== evidence.path || previous.sha256 !== evidence.sha256 || previous.sizeBytes !== evidence.sizeBytes)) {
          fail(new Error("An unresolved attachment publication cannot change its byte evidence.")); return;
        }
        try {
          intents.put({ ...read.result, mediaPublications: { ...intent.mediaPublications, [evidence.mediaId]: evidence } });
          result(undefined);
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      };
    });
  }

  async writeIntent(scope: OperationScope, operationId: string, contentKey: string): Promise<IndexedWriteIntent | undefined> {
    const operationKey = this.key(scope, operationId);
    return this.transaction(["writeIntents"], "readonly", (tx, result) => {
      const read = typedStore(tx, "writeIntents").index("operationContent").getAll([operationKey, contentKey], 2);
      read.onsuccess = () => {
        // More than one physical target requires explicit reconciliation, never guessing.
        if (read.result.length !== 1) { result(undefined); return; }
        const { key: _key, operationKey: _operation, contentKey: _content, ...intent } = read.result[0]!;
        result(intent);
      };
    });
  }

  async writeReceipt(scope: OperationScope, operationId: string, contentKey: string, notePath: string): Promise<{
    saved: boolean; ledger: PersistedLedgerEntry;
  } | undefined> {
    return this.readSummary("writeReceipts", JSON.stringify([this.key(scope, operationId), contentKey, notePath]));
  }

  /** The receipt, long-lived dedup evidence, projections and per-item callback share one commit. */
  async commitWrite(scope: OperationScope, write: VaultWriteResult, baseRequest: WriteResultsRequest,
    newSave: boolean): Promise<void> {
    const operationId = baseRequest.fetchRunId;
    if (!operationId || baseRequest.runId !== operationId || !baseRequest.fetchId || !baseRequest.writeAttemptId || baseRequest.creatorId !== scope.creatorId
      || write.ledger.contentKey !== write.manifest.contentKey || write.ledger.notePath !== write.manifest.notePath
      || !Number.isFinite(Date.parse(write.ledger.writtenAt)))
      throw new Error("Write evidence is missing its originating task.");
    const scopeKey = this.scopeKey(scope), runKey = this.key(scope, operationId);
    const receiptKey = JSON.stringify([runKey, write.ledger.contentKey, write.ledger.notePath]);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
      JSON.stringify([baseRequest.writeAttemptId, write.ledger.contentKey, write.ledger.notePath]))));
    const idempotencyKey = `write-${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const status = !newSave && write.manifest.action === "skip" && !write.attachments.some(item => item.status === "saved")
      ? "skipped" : write.ledger.completion === "partial" ? "partial" : "success";
    const request: WriteResultsRequest = { ...baseRequest, runComplete: false,
      results: [{ contentKey: write.ledger.contentKey, notePath: write.ledger.notePath, status, media: mediaWriteResults(write),
        ...(write.ledger.completion === "partial" ? { errorCode: "MEDIA_PARTIAL" } : {}) }] };
    await this.transaction<void>(["operations", "pages", "deliverySources", "repairLinks", "writeReceipts", "runStatistics", "creatorStatistics", "localLedgers", "callbacks", "writeIntents", "deliverySummaries"], "readwrite", (tx, result, fail) => {
      const operation = typedStore(tx, "operations").get(runKey);
      operation.onsuccess = () => {
        const source = operation.result;
        if (!source?.sequence || !write.ledger.notePath.startsWith(`${source.snapshot.saveFolderPath.replace(/\/$/, "")}/`)) {
          fail(new Error("Write evidence does not match its original destination.")); return;
        }
        const receipts = typedStore(tx, "writeReceipts"), oldReceipt = receipts.get(receiptKey);
        oldReceipt.onsuccess = () => {
          const previous = oldReceipt.result;
          const saved = newSave || Boolean(previous?.saved);
          // Replaying the same task's already-confirmed note must not downgrade
          // its success to a cross-task reuse receipt.
          if (saved) request.results = request.results.map(item => ({ ...item,
            status: write.ledger.completion === "partial" ? "partial" : "success" }));
          const added = saved && !previous?.saved ? 1 : 0;
          const reusedDelta = !previous && !saved ? 1 : previous && !previous.saved && saved ? -1 : 0;
          const runs = typedStore(tx, "runStatistics"), oldRun = runs.get(runKey);
          oldRun.onsuccess = () => {
            const prior = oldRun.result as (IndexedRunStatistics & { key: string }) | undefined;
            if (prior && prior.sequence !== source.sequence) { fail(new Error("Saved run sequence changed.")); return; }
            const savedAt = newSave && (!prior?.savedAt || Date.parse(write.ledger.writtenAt) > Date.parse(prior.savedAt))
              ? write.ledger.writtenAt : prior?.savedAt;
            const run: IndexedRunStatistics = { fetchRunId: operationId, sequence: source.sequence!,
              savedCount: (prior?.savedCount ?? 0) + added, reusedCount: (prior?.reusedCount ?? 0) + reusedDelta,
              ...(savedAt ? { savedAt } : {}) };
            const creators = typedStore(tx, "creatorStatistics"), oldCreator = creators.get(scopeKey);
            oldCreator.onsuccess = () => {
              const creator: IndexedCreatorStatistics = oldCreator.result ?? { importedCount: 0 };
              const projection: IndexedCreatorStatistics = { ...creator, importedCount: creator.importedCount + added };
              if (run.savedCount > 0 && run.savedAt && (creator.lastSavedRunSequence === undefined || run.sequence >= creator.lastSavedRunSequence)) {
                projection.lastSavedFetchRunId = operationId;
                projection.lastSavedRunSequence = run.sequence;
                projection.lastSavedCount = run.savedCount;
                projection.lastSavedAt = run.savedAt;
              }
              const callbacks = typedStore(tx, "callbacks"), callbackKey = this.key(scope, idempotencyKey), oldCallback = callbacks.get(callbackKey);
              oldCallback.onsuccess = () => {
                try {
                if (oldCallback.result && JSON.stringify(oldCallback.result.request) !== JSON.stringify(request)) {
                  fail(new Error("A persisted write callback cannot change its payload.")); return;
                }
                // This callback and its receipt were committed atomically. A replay must
                // not reapply recovery transitions or overwrite later delivery progress.
                if (oldCallback.result && previous) { result(); return; }
                receipts.put({ key: receiptKey, saved, ledger: write.ledger });
                const intents = typedStore(tx, "writeIntents"), intent = intents.get(receiptKey);
                intent.onsuccess = () => { if (intent.result) intents.put({ ...intent.result, completed: true }); };
                runs.put({ ...run, key: runKey }); creators.put({ ...projection, key: scopeKey });
                typedStore(tx, "localLedgers").put({ key: JSON.stringify([scopeKey, write.ledger.contentKey, source.snapshot.saveFolderPath]), ledger: write.ledger });
                if (!oldCallback.result) callbacks.add({ key: callbackKey,
                  ownerKey: JSON.stringify([this.namespace, scope.userId, scope.installationId]), scope, idempotencyKey, request,
                  status: "pending", attempts: 0, readyAt: 0, version: 0 });
                if (write.ledger.completion === "complete" || write.reconciled) {
                  const pages = typedStore(tx, "pages");
                  const page = pages.index("operationFetch").get([scopeKey, operationId, baseRequest.fetchId!]);
                  page.onsuccess = () => {
                    try {
                      // Legacy/manual callers without an indexed source page keep their existing receipt path.
                      // Indexed writes archive only the matching work in the original page and transaction.
                      if (page.result) {
                        const row = this.deliveryProjection(page.result);
                        const item = row.deliveryItems![write.ledger.contentKey];
                        if (!item) { fail(new Error("Write evidence does not match its original work.")); return; }
                        if (write.ledger.completion === "complete") item.status = "settled";
                        else {
                          if (item.status !== "write_unknown") { fail(new Error("Only an unresolved write can resume from publication evidence.")); return; }
                          const unknownId = item.mediaFailures?.find(media => media.kind === "write_unknown")?.mediaId;
                          const unknownPosition = write.manifest.attachments.findIndex(media => media.mediaId === unknownId);
                          const previous = item.media ?? {};
                          item.media = Object.fromEntries(write.attachments.filter(media => media.status === "failed").map(media => {
                            const index = write.manifest.attachments.findIndex(original => original.mediaId === media.mediaId);
                            const notAttempted = write.attachmentsNotStarted === true || unknownPosition >= 0 && index > unknownPosition;
                            const prior = previous[media.mediaId];
                            const budgetAttempts = Math.max(0, (prior?.budgetAttempts ?? (notAttempted ? 0 : item.budgetAttempts)) - (notAttempted && prior?.status === "pending" ? 1 : 0));
                            const status: DeliveryStatus = prior?.status === "needs_refetch" || prior?.status === "retry_exhausted" ? prior.status
                              : budgetAttempts >= 6 ? "retry_exhausted" : "pending";
                            return [media.mediaId, { status, budgetAttempts, readyAt: notAttempted ? 0 : prior?.readyAt ?? item.readyAt }];
                          }));
                          item.mediaFailures = Object.entries(item.media).map(([mediaId, media]) => ({ mediaId,
                            kind: media.status === "needs_refetch" ? "source_expired" : "retryable" }));
                          item.status = Object.values(item.media).some(media => media.status === "pending") ? "pending"
                            : Object.values(item.media).some(media => media.status === "needs_refetch") ? "needs_refetch" : "retry_exhausted";
                          item.readyAt = Math.min(...Object.values(item.media).filter(media => media.status === item.status).map(media => media.readyAt));
                        }
                        if (write.ledger.completion === "complete") typedStore(tx, "deliverySummaries").get(runKey).onsuccess = event => {
                          try {
                            const previous = (event.target as IDBRequest<StoreRows["deliverySummaries"] | undefined>).result;
                            if (!previous?.completedAt) {
                              typedStore(tx, "deliverySummaries").put({ key: runKey, request });
                              this.completeDelivery(tx, scope, operationId, fail);
                            }
                          } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
                        };
                        pages.put(this.deliveryProjection(row));
                        if (!Object.values(item.media ?? {}).some(media => media.status === "needs_refetch") || item.status === "settled")
                          typedStore(tx, "repairLinks").delete(JSON.stringify([row.key, write.ledger.contentKey]));
                        if (Object.values(row.deliveryItems!).every(work => work.status === "settled"))
                          typedStore(tx, "deliverySources").delete(row.key);
                      }
                      result(undefined);
                    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
                  };
                } else result(undefined);
                } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
              };
            };
          };
        };
      };
    });
  }

  async hasSavedReceipt(scope: OperationScope, operationId: string, contentKey: string, notePath: string): Promise<boolean> {
    const receipt = await this.readSummary<{ saved: boolean }>("writeReceipts", JSON.stringify([this.key(scope, operationId), contentKey, notePath]));
    return Boolean(receipt?.saved);
  }

  async runStatistics(scope: OperationScope, operationId: string): Promise<IndexedRunStatistics | undefined> {
    return this.readSummary("runStatistics", this.key(scope, operationId));
  }
  async creatorStatistics(scope: OperationScope): Promise<IndexedCreatorStatistics | undefined> {
    return this.readSummary("creatorStatistics", this.scopeKey(scope));
  }
  async localLedger(scope: OperationScope, contentKey: string, folderPath: string): Promise<PersistedLedgerEntry | undefined> {
    const row = await this.readSummary<{ ledger: PersistedLedgerEntry }>("localLedgers", JSON.stringify([this.scopeKey(scope), contentKey, folderPath]));
    return row?.ledger;
  }
  private async readSummary<T>(store: string, key: string): Promise<T | undefined> {
    return this.transaction([store], "readonly", (tx, result) => {
      const read = typedStore(tx, store).get(key);
      read.onsuccess = () => {
        if (!read.result) { result(undefined); return; }
        const { key: _key, ...value } = read.result; result(value as T);
      };
    });
  }

  async queueCallback(scope: OperationScope, idempotencyKey: string, request: WriteResultsRequest): Promise<IndexedCallback> {
    if (!idempotencyKey || request.creatorId !== scope.creatorId || !request.fetchRunId
      || request.runId !== request.fetchRunId) throw new Error("Callback identity is incomplete.");
    const key = this.key(scope, idempotencyKey);
    const callback: IndexedCallback = { scope, idempotencyKey, request, status: "pending", attempts: 0, readyAt: 0, version: 0 };
    return this.transaction(["callbacks"], "readwrite", (tx, result, fail) => {
      const callbacks = typedStore(tx, "callbacks"), read = callbacks.get(key);
      read.onsuccess = () => {
        if (read.result) {
          if (JSON.stringify(read.result.request) !== JSON.stringify(request)) {
            fail(new Error("A persisted callback cannot change its payload.")); return;
          }
          result(this.publicCallback(read.result)); return;
        }
        callbacks.add({ ...callback, key, ownerKey: JSON.stringify([this.namespace, scope.userId, scope.installationId]) });
        result(callback);
      };
    });
  }

  async callback(scope: OperationScope, idempotencyKey: string): Promise<IndexedCallback | undefined> {
    const key = this.key(scope, idempotencyKey);
    return this.transaction(["callbacks"], "readonly", (tx, result) => {
      const read = typedStore(tx, "callbacks").get(key);
      read.onsuccess = () => result(read.result ? this.publicCallback(read.result) : undefined);
    });
  }

  async dueCallbacks(owner: Pick<OperationScope, "userId" | "installationId">, now: number, limit = 25): Promise<IndexedCallback[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid callback page size.");
    const prefix = [JSON.stringify([this.namespace, owner.userId, owner.installationId]), "pending"];
    return this.transaction(["callbacks"], "readonly", (tx, result) => {
      const read = typedStore(tx, "callbacks").index("due").getAll(IDBKeyRange.bound(prefix, [...prefix, now, []]), limit);
      read.onsuccess = () => result(read.result.map(row => this.publicCallback(row)));
    });
  }

  async updateCallback(callback: IndexedCallback, patch: Pick<IndexedCallback, "status" | "attempts" | "readyAt">): Promise<IndexedCallback | undefined> {
    const key = this.key(callback.scope, callback.idempotencyKey);
    return this.transaction(["callbacks"], "readwrite", (tx, result) => {
      const callbacks = typedStore(tx, "callbacks"), read = callbacks.get(key);
      read.onsuccess = () => {
        const stored = read.result;
        if (!stored || stored.version !== callback.version || stored.status !== "pending") { result(undefined); return; }
        const updated = { ...stored, ...patch, version: stored.version + 1 };
        callbacks.put(updated); result(this.publicCallback(updated));
      };
    });
  }

  private publicCallback(row: IndexedCallback & { key: string; ownerKey: string }): IndexedCallback {
    const { key: _key, ownerKey: _owner, ...callback } = row;
    return callback;
  }

  /** Update only the newest started run; a late older success may advance the success time. */
  private projectSource(tx: IDBTransaction, operation: StoredOperation): void {
    if (!operation.executionStartedAt || operation.sequence === undefined) return;
    const summaries = typedStore(tx, "creatorPresentation"), read = summaries.get(operation.scopeKey);
    read.onsuccess = () => {
      const previous = (read.result ?? { key: operation.scopeKey });
      const updated = { ...previous };
      if (operation.sequence! >= (previous.lastFetchRunSequence ?? 0)) Object.assign(updated, {
        lastFetchRunSequence: operation.sequence, runState: operation.status,
        lastError: operation.errorMessage ?? operation.errorCode, retryAt: operation.retryAt
      });
      // A queued-before-resume task can start afterwards and supersede the reset.
      if (previous.statusResetAt && operation.status === "running"
          && operation.dispatchedAt && compareUtcTime(operation.dispatchedAt, previous.statusResetAt) >= 0)
        updated.statusResetSuperseded = true;
      if (operation.status === "source_succeeded" && operation.sourceCheckedAt
          && (!updated.lastSuccessfulCheckAt || compareUtcTime(operation.sourceCheckedAt, updated.lastSuccessfulCheckAt) > 0))
        updated.lastSuccessfulCheckAt = operation.sourceCheckedAt;
      summaries.put(updated);
    };
  }

  /** A resume changes presentation only. Original tasks, writes and callbacks remain intact. */
  async resetCreatorStatus(scope: OperationScope, resumedAt: string): Promise<void> {
    const key = this.scopeKey(scope);
    await this.transaction<void>(["watermarks", "creatorPresentation"], "readwrite", (tx, result) => {
      const summaries = typedStore(tx, "creatorPresentation"), read = summaries.get(key);
      read.onsuccess = () => {
        const previous = read.result as (CreatorLocalStatus & { key: string }) | undefined;
        if (previous?.statusResetAt && compareUtcTime(previous.statusResetAt, resumedAt) >= 0) { result(); return; }
        const watermark = typedStore(tx, "watermarks").get(key);
        watermark.onsuccess = () => {
          summaries.put({ ...previous, key, statusResetAt: resumedAt,
            statusResetSequence: watermark.result?.lastSequence ?? previous?.lastFetchRunSequence ?? 0,
            statusResetSuperseded: false });
          result();
        };
      };
    });
  }

  /** Each queue lookup reads at most one index key, regardless of retained history size. */
  async creatorStatus(scope: OperationScope, folderPath: string): Promise<CreatorLocalStatus> {
    const scopeKey = this.scopeKey(scope);
    return this.transaction(["creatorPresentation", "operations", "pages", "callbacks"], "readonly", (tx, result) => {
      const facts: CreatorLocalStatus = {};
      const summary = typedStore(tx, "creatorPresentation").get(scopeKey);
      summary.onsuccess = () => {
        if (summary.result) { const { key: _key, ...value } = summary.result; Object.assign(facts, value); }
      };
      const exists = (store: string, index: string, prefix: IDBValidKey[], flag: keyof CreatorLocalStatus) => {
        const read = typedStore(tx, store).index(index).getKey(IDBKeyRange.bound(prefix, [...prefix, []]));
        read.onsuccess = () => { if (read.result !== undefined) Object.assign(facts, { [flag]: true }); };
      };
      for (const status of ["queued", "waiting_continuation"])
        exists("operations", "targetStatus", [scopeKey, folderPath, status], "checkQueued");
      exists("pages", "itemTarget", [scopeKey, folderPath, "pending"], "saveQueued");
      exists("pages", "itemTarget", [scopeKey, folderPath, "write_unknown"], "writeUnknown");
      for (const status of ["needs_refetch", "retry_exhausted"])
        exists("pages", "itemTarget", [scopeKey, folderPath, status], "writeFailed");
      for (const status of ["pending", "requires_reconciliation"])
        exists("callbacks", "creatorStatus", [JSON.stringify([this.namespace, scope.userId, scope.installationId]),
          scope.creatorId, status], "receiptPending");
      result(facts);
    });
  }

  /** CAS protects a newer dispatch/result from a late callback or second renderer. */
  async transition(scope: OperationScope, operationId: string, expectedVersion: number,
    patch: OperationPatch): Promise<SourceOperation | undefined> {
    const key = this.key(scope, operationId);
    const changed = await this.transaction<SourceOperation | undefined>(["operations", "creatorPresentation"], "readwrite", (tx, result, fail) => {
      const tasks = typedStore(tx, "operations"), read = tasks.get(key);
      read.onsuccess = () => {
        const operation = read.result;
        if (!operation || operation.version !== expectedVersion) { result(undefined); return; }
        if (patch.snapshot && (operation.status !== "queued" || operation.executionStartedAt || operation.dispatchedAt || operation.attempts !== 0
            || JSON.stringify(patch.snapshot) !== JSON.stringify({...operation.snapshot,saveFolderId:patch.snapshot.saveFolderId,saveFolderPath:patch.snapshot.saveFolderPath}))) {
          fail(new Error("Only an unstarted operation may adopt a new folder within the same target."));return;
        }
        if (patch.status && patch.status !== operation.status && !transitions[operation.status].has(patch.status)) {
          fail(new Error("Invalid execution transition.")); return;
        }
        if (patch.status === "cancelled" && (operation.executionStartedAt || !patch.cancellationReason)) {
          fail(new Error("Only unstarted operations can be cancelled by configuration.")); return;
        }
        if (patch.status === "queued" && (!Object.hasOwn(patch, "dispatchedAt") || !Object.hasOwn(patch, "executionStartedAt")
            || patch.dispatchedAt !== undefined || patch.executionStartedAt !== undefined
            || patch.attempts !== 0 || operation.attempts !== 1)) {
          fail(new Error("Only an explicitly unsent first claim can return to the queue.")); return;
        }
        if (patch.status === "running" && (!patch.attemptKey || !patch.dispatchedAt
            || !(operation.executionStartedAt ?? patch.executionStartedAt))) {
          fail(new Error("Dispatch requires a durable attempt identity and timestamps.")); return;
        }
        const updated: StoredOperation = { ...operation, ...patch, version: operation.version + 1 };
        tasks.put(updated); this.projectSource(tx, updated); result(this.publicOperation(updated));
      };
    });
    if (changed) recordDiagnostic("operation.transition", scope, { creatorId: scope.creatorId, operationId,
      status: changed.status, attempts: changed.attempts, version: changed.version, requestId: changed.requestId,
      retryAt: changed.retryAt, completedAt: changed.completedAt, errorCode: changed.errorCode });
    return changed;
  }
}

// IndexedDB has untyped reads; keep each store's schema at this boundary.
interface StoreRows {
  operations: StoredOperation;
  pages: StoredDeliveryPage;
  watermarks: ScheduleWatermark & { scopeKey: string; creatorId: string; ownerKey: string };
  writeIntents: IndexedWriteIntent & { key: string; operationKey: string; contentKey: string };
  callbacks: IndexedCallback & { key: string; ownerKey: string };
  runStatistics: IndexedRunStatistics & { key: string };
  creatorStatistics: IndexedCreatorStatistics & { key: string };
  creatorPresentation: CreatorLocalStatus & { key: string };
  deliverySources: { key: string; previews: CreatorUpdatePage["previews"] };
  repairLinks: { key: string; pageKey: string };
  deliverySummaries: { key: string; request?: WriteResultsRequest; completedAt?: string };
  writeReceipts: { key: string; saved: boolean };
  localLedgers: { key: string; ledger: PersistedLedgerEntry };
}
type TypedCursor<T> = Omit<IDBCursorWithValue, "value"> & { value: T };
type TypedIndex<T> = Omit<IDBIndex, "get" | "getAll" | "openCursor"> & {
  get(query: IDBValidKey | IDBKeyRange): IDBRequest<T | undefined>;
  getAll(query?: IDBValidKey | IDBKeyRange | null, count?: number): IDBRequest<T[]>;
  openCursor(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection): IDBRequest<TypedCursor<T> | null>;
};
type TypedStore<T> = Omit<IDBObjectStore, "get" | "getAll" | "openCursor" | "index"> & Pick<TypedIndex<T>, "get" | "getAll" | "openCursor"> & { index(name: string): TypedIndex<T> };
function typedStore<K extends keyof StoreRows>(tx: IDBTransaction, name: K): TypedStore<StoreRows[K]>;
function typedStore(tx: IDBTransaction, name: string): TypedStore<Record<string, unknown>>;
function typedStore(tx: IDBTransaction, name: string): unknown { return tx.objectStore(name); }
