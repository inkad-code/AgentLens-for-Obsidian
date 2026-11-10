import { DeviceLocalPluginDataAdapter, IndexedDeviceLocalState } from "./DeviceLocalPluginDataAdapter";
import { hostExecutionLocks } from "./HostExecutionLocks";
import { PluginStateStore, type PluginDataAdapter } from "./PluginStateStore";

interface VaultLocalStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, value: unknown): void;
}
interface Identity {
  version: 1;
  namespace: string;
  installationId: string;
  operationNamespace: string;
  origin: "new" | "legacy";
  phase: "reserved" | "ready";
}
const KEY = "agentlens-device-execution-state-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LegacyInstallationRecoveryRequired extends Error {
  constructor(readonly canStartNew: boolean) { super("Verify the original installation before continuing."); }
}

/** A durable reservation couples the installation identity to its original operation namespace. */
export async function openDeviceLocalExecutionState(
  host: VaultLocalStorage,
  shared: PluginDataAdapter,
  verifyLegacyOwnership: (legacy: unknown) => Promise<boolean>,
  randomId: () => string = () => crypto.randomUUID(),
  startAsNewDevice = false
): Promise<{ stateStore: PluginStateStore; operationNamespace: string }> {
  return hostExecutionLocks.run(["device-execution-state-bootstrap"], async () => {
    let identity = readIdentity(host);
    if (startAsNewDevice && identity) throw new Error("An installation identity already exists. Retain it for recovery.");
    const verify = async (legacy: unknown): Promise<boolean> => {
      try { if (await verifyLegacyOwnership(legacy)) return true; } catch { /* Preserve evidence; allow an explicit retry. */ }
      throw new LegacyInstallationRecoveryRequired(!identity);
    };
    if (!identity) {
      const root = await shared.loadData();
      if (root != null && (typeof root !== "object" || Array.isArray(root))) throw new Error("Retain malformed shared plugin data before migration.");
      const legacy = (root as Record<string, unknown> | null)?.agentlensState;
      const legacyId = startAsNewDevice ? undefined : installationOf(legacy);
      if (!startAsNewDevice && legacy !== undefined) {
        if (!legacyId) throw new LegacyInstallationRecoveryRequired(true);
        await verify(structuredClone(legacy));
      }
      const namespace = randomId();
      const installationId = legacyId ?? randomId();
      if (!UUID.test(namespace) || (!legacyId && !UUID.test(installationId))) throw new Error("Device-local identity generation failed.");
      identity = {version: 1, namespace, installationId, operationNamespace: legacyId ? "obsidian" : `obsidian:${namespace}`,
        origin: legacyId ? "legacy" : "new", phase: "reserved"};
      persistIdentity(host, identity);
    }
    const selected = identity;
    const local = new IndexedDeviceLocalState(selected.namespace);
    const existing = await local.read();
    // A lost database is not a new installation. Preserve the marker for recovery.
    if (selected.phase === "ready" && !existing) throw new Error("Device execution records are unavailable; retain the original identity for recovery.");
    if (!existing && selected.origin === "legacy") {
      const root = await shared.loadData() as Record<string, unknown> | null;
      if (installationOf(root?.agentlensState) !== selected.installationId)
        throw new Error("The reserved legacy migration source is unavailable; retain the reservation.");
    }
    const adapterFor = (initializeMissing: boolean) => new DeviceLocalPluginDataAdapter(shared, local, () => ({schemaVersion: 1,
      installationId: selected.installationId, ledger: {}, pendingActions: [], creatorDiagnostics: {}, uiPreferences: {}}),
    async legacy => selected.origin === "legacy" && installationOf(legacy) === selected.installationId
      && await verify(legacy), initializeMissing, selected.origin === "legacy");
    const adapter = adapterFor(selected.phase === "reserved");
    const envelope = await adapter.loadData() as Record<string, unknown>;
    if (installationOf(envelope.agentlensState) !== selected.installationId)
      throw new Error("Device execution identity does not match its retained records.");
    if (JSON.stringify(readIdentity(host)) !== JSON.stringify(selected)) throw new Error("Device execution identity changed during recovery.");
    if (selected.phase !== "ready") persistIdentity(host, {...selected, phase: "ready"});
    const existingAdapter = adapterFor(false);
    const ready = {...selected, phase: "ready"};
    const assertIdentity = () => {
      if (JSON.stringify(readIdentity(host)) !== JSON.stringify(ready)) throw new Error("Device execution identity changed; reopen the Vault before continuing.");
    };
    const assertRecords = async () => {
      assertIdentity();
      const record = await local.read();
      if (!record || installationOf(record.state) !== selected.installationId)
        throw new Error("Device execution records are unavailable; retain the original identity for recovery.");
      assertIdentity();
    };
    const guarded: PluginDataAdapter = {
      loadData: async () => { await assertRecords(); const data = await existingAdapter.loadData(); assertIdentity(); return data; },
      saveData: async data => {
        assertIdentity();
        if (installationOf((data as Record<string, unknown>)?.agentlensState) !== selected.installationId)
          throw new Error("Device execution identity cannot be replaced while saving state.");
        await existingAdapter.saveData(data); assertIdentity();
      }
    };
    return {stateStore: new PluginStateStore(guarded), operationNamespace: selected.operationNamespace};
  });
}

function installationOf(state: unknown): string | undefined {
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  const id = (state as Record<string, unknown>).installationId;
  return typeof id === "string" && id.trim() === id && id.length > 0 ? id : undefined;
}
function readIdentity(host: VaultLocalStorage): Identity | undefined {
  const value = host.loadLocalStorage(KEY);
  if (value == null) return undefined;
  const r = value as Identity;
  if (r.version !== 1 || typeof r.namespace !== "string" || !UUID.test(r.namespace)
    || typeof r.installationId !== "string" || !r.installationId.trim()
    || (r.origin !== "new" && r.origin !== "legacy") || (r.phase !== "reserved" && r.phase !== "ready")
    || r.operationNamespace !== (r.origin === "legacy" ? "obsidian" : `obsidian:${r.namespace}`))
    throw new Error("Retain malformed device execution identity before recovery.");
  return structuredClone(r);
}
function persistIdentity(host: VaultLocalStorage, identity: Identity): void {
  host.saveLocalStorage(KEY, structuredClone(identity));
  if (JSON.stringify(readIdentity(host)) !== JSON.stringify(identity)) throw new Error("Device execution identity could not be persisted.");
}
