/** Diagnostics are best-effort observations, never execution state or credentials. */
export interface DiagnosticScope { userId: string; installationId: string }
export type DiagnosticFields = Record<string, unknown>;
export interface DiagnosticEvent { at: number; event: string; scope: DiagnosticScope; fields: Record<string, string | number | boolean> }
const identifiers = new Set(['creatorId', 'operationId', 'fetchRunId', 'requestId', 'jobId', 'fetchId', 'installationId', 'userId']);
const labels = new Set(['status', 'reason', 'trigger', 'platform', 'errorCode', 'phase', 'method', 'result', 'route']);
const times = new Set(['scheduledAt', 'queuedAt', 'executionStartedAt', 'dispatchedAt', 'completedAt', 'retryAt', 'nextCheckAt', 'scheduleAnchorAt', 'lastSuccessfulCheckAt', 'lastCheckedAt', 'lastSavedAt', 'pausedAt', 'activationAt', 'observedThrough', 'recoveryFrom', 'createdAt', 'updatedAt', 'nextAttemptAt', 'lastFailedAt']);
const numbers = new Set(['attempts', 'version', 'configRevision', 'durationMs', 'httpStatus', 'count', 'chargedUnits', 'activeSourceRuns', 'activeManualRuns', 'frequencyEvery', 'gapMs']);
const booleans = new Set(['online', 'authenticated', 'autoFetchEnabled', 'hasCursor', 'coverageComplete', 'truncated']);
export function safeFields(input: DiagnosticFields): DiagnosticEvent['fields'] {
  const out: DiagnosticEvent['fields'] = {};
  const fields = { ...input, errorCode: input.errorCode ?? input.lastErrorCode,
    requestId: input.requestId ?? input.lastRequestId, reason: input.reason ?? input.cancellationReason };
  for (const [key, value] of Object.entries(fields)) {
    if (numbers.has(key) && typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (booleans.has(key) && typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length <= 160) {
      if (identifiers.has(key) && /^[a-zA-Z0-9_-]+$/.test(value)) out[key] = value;
      else if (labels.has(key) && /^[a-zA-Z0-9_.-]+$/.test(value)) out[key] = value;
      else if (times.has(key) && /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(value) && Number.isFinite(Date.parse(value))) out[key] = value;
    }
  }
  return out;
}
function safeScope(scope: DiagnosticScope): DiagnosticScope | undefined {
  const fields = safeFields(scope as unknown as DiagnosticFields);
  return typeof fields.userId === "string" && typeof fields.installationId === "string"
    ? { userId: fields.userId, installationId: fields.installationId } : undefined;
}
const MAX_EVENTS = 4000;
const RETENTION_MS = 72 * 60 * 60 * 1000;
const MAX_PENDING = 200;

export class DiagnosticLog {
  private pending: DiagnosticEvent[] = [];
  private timer: number | undefined;
  private writing: Promise<void> | undefined;
  private db: Promise<IDBDatabase> | undefined;
  dropped = 0;
  storageFailures = 0;
  constructor(private readonly name = 'agentlens-obsidian-diagnostics-v1', private readonly now = Date.now,
    private readonly maxEvents = MAX_EVENTS, private readonly retentionMs = RETENTION_MS) {}

  record(event: string, scope: DiagnosticScope, fields: DiagnosticFields = {}): void {
    try {
      if (!/^[a-z][a-z0-9_.]{0,63}$/.test(event)) return;
      if (this.pending.length >= MAX_PENDING) { this.dropped++; return; }
      const owner = safeScope(scope);
      if (!owner) { this.dropped++; return; }
      const row = { at: this.now(), event, scope: owner, fields: safeFields(fields) };
      if (JSON.stringify(row).length > 2048) { this.dropped++; return; }
      this.pending.push(row);
      this.timer ??= window.setTimeout(() => { this.timer = undefined; void this.flush(); }, 250);
    } catch { this.dropped++; }
  }
  private open(): Promise<IDBDatabase> {
    return this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('Diagnostic storage unavailable')); return; }
      const request = indexedDB.open(this.name, 1);
      let expired = false;
      const timeout = window.setTimeout(() => { expired = true; reject(new Error('Diagnostic storage timed out')); }, 2000);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('events', { autoIncrement: true });
        store.createIndex('at', 'at');
      };
      request.onerror = () => { window.clearTimeout(timeout); reject(request.error ?? new Error("Diagnostic storage failed.")); };
      request.onsuccess = () => {
        window.clearTimeout(timeout);
        if (expired) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); this.db = undefined; };
        resolve(request.result);
      };
    }).catch(error => { this.db = undefined; throw error; });
  }
  async flush(): Promise<void> {
    if (this.timer !== undefined) { window.clearTimeout(this.timer); this.timer = undefined; }
    if (this.writing) { await this.writing; return this.pending.length ? this.flush() : undefined; }
    const batch = this.pending.splice(0);
    this.writing = Promise.resolve().then(async () => {
      if (!batch.length) return;
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('events', 'readwrite');
        const timeout = window.setTimeout(() => { try { tx.abort(); } catch { /* already settled */ } }, 3000);
        tx.oncomplete = () => { window.clearTimeout(timeout); resolve(); };
        tx.onabort = () => { window.clearTimeout(timeout); reject(tx.error ?? new Error("Diagnostic transaction failed.")); };
        const store = tx.objectStore('events');
        for (const row of batch) store.add(row);
        // Indexed cursor prunes incrementally; never deserialize the retained history to append.
        const count = store.count();
        count.onsuccess = () => {
          let excess = Math.max(0, count.result - this.maxEvents);
          const cursor = store.index('at').openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            if (excess > 0 || Number(row.key) < this.now() - this.retentionMs) {
              row.delete(); excess--; row.continue();
            }
          };
        };
      });
    }).catch(() => { this.storageFailures++; this.dropped += batch.length; }).finally(() => { this.writing = undefined; });
    return this.writing;
  }
  async read(scope: DiagnosticScope, since: number): Promise<{ events: DiagnosticEvent[]; retainedFrom?: number | undefined; dropped: number; storageFailures: number }> {
    if (!safeScope(scope) || !Number.isFinite(since)) throw new Error("Invalid diagnostic scope or time.");
    await this.flush();
    const db = await this.open();
    const events = await new Promise<DiagnosticEvent[]>((resolve, reject) => {
      const tx = db.transaction('events', 'readonly');
      const rows: DiagnosticEvent[] = [];
      const timeout = window.setTimeout(() => { try { tx.abort(); } catch { /* already settled */ } }, 3000);
      tx.oncomplete = () => { window.clearTimeout(timeout); resolve(rows); };
      tx.onabort = () => { window.clearTimeout(timeout); reject(tx.error ?? new Error("Diagnostic transaction failed.")); };
      const cursor = tx.objectStore('events').index('at').openCursor(IDBKeyRange.lowerBound(Math.max(since, this.now() - this.retentionMs)));
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const value = row.value as DiagnosticEvent;
        if (value.scope.userId === scope.userId && value.scope.installationId === scope.installationId)
          rows.push({ at: value.at, event: value.event, scope: { userId: scope.userId, installationId: scope.installationId }, fields: safeFields(value.fields) });
        row.continue();
      };
    });
    return { events, retainedFrom: events[0]?.at, dropped: this.dropped, storageFailures: this.storageFailures };
  }
}
let active: DiagnosticLog | undefined;
export function enableDiagnostics(log: DiagnosticLog | undefined): void { active = log; }
export function recordDiagnostic(event: string, scope: DiagnosticScope, fields: DiagnosticFields = {}): void {
  try { active?.record(event, scope, fields); } catch { /* Diagnostics must never affect execution. */ }
}

export function activeDiagnosticLog(): DiagnosticLog | undefined { return active; }
