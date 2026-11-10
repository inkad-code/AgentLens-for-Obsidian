import type { PluginDataAdapter } from "./PluginStateStore";

export interface DeviceLocalRecord { version: 1; revision: number; state: unknown }
const REVISION = "agentlensDeviceStateRevision";
export interface DeviceLocalStatePersistence {
  read(): Promise<DeviceLocalRecord | undefined>;
  commit(expectedRevision: number | undefined, state: unknown): Promise<DeviceLocalRecord>;
}

/** Splits device execution facts from shared plugin preferences. Migration is explicit and non-destructive. */
export class DeviceLocalPluginDataAdapter implements PluginDataAdapter {
  constructor(private readonly shared: PluginDataAdapter, private readonly local: DeviceLocalStatePersistence,
    private readonly initialState: () => unknown,
    private readonly mayAdoptLegacy: (legacy: unknown) => Promise<boolean>,
    private readonly initializeMissing = true, private readonly adoptSharedLegacy = true) {}

  async loadData(): Promise<unknown> {
    const shared = envelope(await this.shared.loadData());
    let record = await this.local.read();
    if (!record) {
      if (!this.initializeMissing) throw new Error("Device execution records are unavailable; retain the original identity for recovery.");
      const legacy = this.adoptSharedLegacy ? shared.agentlensState : undefined;
      if (legacy !== undefined && !await this.mayAdoptLegacy(structuredClone(legacy)))
        throw new Error("Verify the original installation before migrating its execution records.");
      record = await this.local.commit(undefined, structuredClone(legacy === undefined ? this.initialState() : legacy));
    }
    if (record.version !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1 || !record.state || typeof record.state !== "object" || Array.isArray(record.state))
      throw new Error("Retain the device-local state before repairing its format.");
    return {...shared, [REVISION]: record.revision, agentlensState: structuredClone(record.state)};
  }

  async saveData(data: unknown): Promise<void> {
    const incoming = envelope(data);
    if (!incoming.agentlensState || typeof incoming.agentlensState !== "object" || Array.isArray(incoming.agentlensState))
      throw new Error("Device-local execution state is required.");
    const expectedRevision = incoming[REVISION];
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) throw new Error("Initialize device-local state before saving it.");
    const shared = envelope(await this.shared.loadData());
    const {agentlensState: _localState, [REVISION]: _revision, ...preferences} = incoming;
    const nextShared = {...preferences};
    // Keep the original migration source, not the current device's identity/commands/receipts.
    if (Object.prototype.hasOwnProperty.call(shared, "agentlensState")) nextShared.agentlensState = shared.agentlensState;
    if (JSON.stringify(nextShared) !== JSON.stringify(shared)) await this.shared.saveData(nextShared);
    await this.local.commit(Number(expectedRevision), structuredClone(incoming.agentlensState));
  }
}
function envelope(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Plugin data is malformed; retain it before migration.");
  return value as Record<string, unknown>;
}

/** Caller supplies a Vault-local namespace; transaction completion, not request success, confirms writes. */
export class IndexedDeviceLocalState implements DeviceLocalStatePersistence {
  constructor(private readonly namespace: string) {
    if (!namespace.trim()) throw new Error("A device-local state namespace is required.");
  }
  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open(`agentlens-device-state:${this.namespace}`, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("state"); };
      request.onerror = () => reject(request.error ?? new Error("Device-local database open failed."));
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
      request.onblocked = () => { blocked = true; reject(new Error("Device-local state upgrade is blocked.")); };
    });
  }
  async read(): Promise<DeviceLocalRecord | undefined> {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("state", "readonly");
        const request = transaction.objectStore("state").get("current");
        transaction.oncomplete = () => resolve(request.result as DeviceLocalRecord | undefined);
        transaction.onabort = () => reject(transaction.error ?? new Error("Device-local read aborted."));
        transaction.onerror = () => reject(transaction.error ?? new Error("Device-local transaction failed."));
      });
    } finally { db.close(); }
  }
  async commit(expectedRevision: number | undefined, state: unknown): Promise<DeviceLocalRecord> {
    const db = await this.open();
    try {
      return await new Promise<DeviceLocalRecord>((resolve, reject) => {
        const transaction = db.transaction("state", "readwrite");
        const store = transaction.objectStore("state");
        const request = store.get("current");
        let result: DeviceLocalRecord;
        let conflict: Error | undefined;
        request.onsuccess = () => {
          const current = request.result as DeviceLocalRecord | undefined;
          if (expectedRevision === undefined && current) { result = current; return; }
          if (expectedRevision !== undefined && (!current || current.version !== 1 || current.revision !== expectedRevision)) {
            conflict = new Error("Device-local state changed concurrently; reload before retrying."); transaction.abort(); return;
          }
          result = {version: 1, revision: (current?.revision ?? 0) + 1, state};
          if (!Number.isSafeInteger(result.revision) || result.revision < 1) {
            conflict = new Error("Device-local state revision cannot advance safely."); transaction.abort(); return;
          }
          store.put(result, "current");
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(conflict ?? transaction.error ?? new Error("Device-local write aborted."));
        transaction.onerror = () => reject(transaction.error ?? new Error("Device-local transaction failed."));
      });
    } finally { db.close(); }
  }
}
