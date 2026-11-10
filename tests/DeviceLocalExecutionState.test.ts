import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { openDeviceLocalExecutionState } from "../src/runtime/DeviceLocalExecutionState";
import { IndexedDeviceLocalState } from "../src/runtime/DeviceLocalPluginDataAdapter";

const KEY = "agentlens-device-execution-state-v1";
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
function fixture() {
  const values = new Map<string, unknown>(); let n = 0; let shared: unknown = {};
  const host = {loadLocalStorage: (key: string) => structuredClone(values.get(key)),
    saveLocalStorage: (key: string, value: unknown) => {values.set(key, structuredClone(value));}};
  const data = {loadData: async () => structuredClone(shared), saveData: async (value: unknown) => {shared = structuredClone(value);}};
  const random = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const verify = vi.fn(async () => false);
  return {host, values, data, verify, setShared: (value: unknown) => {shared = value;},
    open: () => openDeviceLocalExecutionState(host, data, verify, random)};
}
const legacy = {schemaVersion: 1, installationId: "old-install", ledger: {}, pendingActions: [{id: "old-op", kind: "remote_action", createdAt: "now", payload: {}}], creatorDiagnostics: {}, uiPreferences: {}};

it("keeps new identity and operation namespace together across restarts without sharing either", async () => {
  const f = fixture(); const a = await f.open(); const state = await a.stateStore.load();
  const b = await f.open();
  expect((await b.stateStore.load()).installationId).toBe(state.installationId);
  expect(b.operationNamespace).toBe(a.operationNamespace); expect(a.operationNamespace).not.toBe("obsidian");
  expect(await f.data.loadData()).toEqual({}); expect(f.verify).not.toHaveBeenCalled();
});
it("requires affirmative legacy ownership and retains original operation namespace and pending evidence", async () => {
  const f = fixture(); f.setShared({agentlensState: legacy});
  await expect(f.open()).rejects.toThrow("Verify"); expect(f.values.size).toBe(0);
  f.verify.mockResolvedValue(true); const opened = await f.open();
  expect(opened.operationNamespace).toBe("obsidian");
  expect(await opened.stateStore.load()).toMatchObject(legacy);
  expect(await f.data.loadData()).toEqual({agentlensState: legacy});
});
it("does not regenerate identity when an established database is missing", async () => {
  const f = fixture(); await f.open(); const identity = f.values.get(KEY);
  vi.stubGlobal("indexedDB", new IDBFactory());
  await expect(f.open()).rejects.toThrow("records are unavailable"); expect(f.values.get(KEY)).toEqual(identity);
});
it("resumes a persisted new reservation after interrupted initialization", async () => {
  const f = fixture(); await f.open(); const identity = f.values.get(KEY) as Record<string, unknown>;
  f.values.set(KEY, {...identity, phase: "reserved"}); vi.stubGlobal("indexedDB", new IDBFactory());
  const recovered = await f.open(); expect((await recovered.stateStore.load()).installationId).toBe(identity.installationId);
  expect(f.values.get(KEY)).toEqual(identity);
});
it("does not recreate an empty legacy history after the reserved migration source disappears", async () => {
  const f = fixture(); f.setShared({agentlensState: legacy}); f.verify.mockResolvedValue(true); await f.open();
  const identity = f.values.get(KEY) as Record<string, unknown>; f.values.set(KEY, {...identity, phase: "reserved"});
  vi.stubGlobal("indexedDB", new IDBFactory()); f.setShared({});
  await expect(f.open()).rejects.toThrow("migration source is unavailable");
  expect(await new IndexedDeviceLocalState(String(identity.namespace)).read()).toBeUndefined();
});
it("ignores copied shared state after initialization but rejects runtime identity replacement", async () => {
  const f = fixture(); const opened = await f.open(); const original = await opened.stateStore.load();
  f.setShared({agentlensState: legacy});
  expect((await (await f.open()).stateStore.load()).installationId).toBe(original.installationId);
  await expect(opened.stateStore.update(s => {s.installationId = "foreign";})).rejects.toThrow("cannot be replaced");
  expect((await opened.stateStore.load()).installationId).toBe(original.installationId);
  f.values.delete(KEY); await expect(opened.stateStore.load()).rejects.toThrow("identity changed");
});
it("rejects damaged or unsaved host identity without initializing execution records", async () => {
  const f = fixture(); f.values.set(KEY, {version: 99}); await expect(f.open()).rejects.toThrow("malformed");
  f.values.clear(); f.host.saveLocalStorage = () => {}; await expect(f.open()).rejects.toThrow("persisted");
});

it("does not reconstruct missing records through an already open state store", async () => {
  const f = fixture(); const opened = await f.open(); const identity = f.values.get(KEY) as Record<string, unknown>;
  vi.stubGlobal("indexedDB", new IDBFactory());
  await expect(opened.stateStore.load()).rejects.toThrow("records are unavailable");
  expect(await new IndexedDeviceLocalState(String(identity.namespace)).read()).toBeUndefined();
});

it("starts an explicitly confirmed new device without adopting or deleting copied legacy evidence", async () => {
  const f = fixture(); f.setShared({agentlensState: legacy, agentlensSettings: {locale: "en"}});
  const opened = await openDeviceLocalExecutionState(f.host, f.data, f.verify, undefined, true);
  const state = await opened.stateStore.load();
  expect(state.installationId).not.toBe(legacy.installationId);
  expect(state.pendingActions).toEqual([]); expect(state.ledger).toEqual({});
  expect(state.refreshTokenSecretId).toBeUndefined(); expect(opened.operationNamespace).not.toBe("obsidian");
  await opened.stateStore.update(s => {s.uiPreferences.recentFolder = "New";});
  expect(await f.data.loadData()).toEqual({agentlensState: legacy, agentlensSettings: {locale: "en"}});
  expect(f.verify).not.toHaveBeenCalled();
  expect((await (await f.open()).stateStore.load()).installationId).toBe(state.installationId);
});
it("never uses the new-device choice to replace an existing reservation or missing device database", async () => {
  const f = fixture(); await f.open(); const before = structuredClone([...f.values]);
  vi.stubGlobal("indexedDB", new IDBFactory());
  await expect(openDeviceLocalExecutionState(f.host, f.data, f.verify, undefined, true)).rejects.toThrow("already exists");
  expect([...f.values]).toEqual(before);
});
