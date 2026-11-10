import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { DeviceLocalPluginDataAdapter, IndexedDeviceLocalState } from "../src/runtime/DeviceLocalPluginDataAdapter";
import { PluginStateStore } from "../src/runtime/PluginStateStore";
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
const initial = (installationId: string) => ({schemaVersion: 1, installationId, ledger: {}, pendingActions: [], creatorDiagnostics: {}, uiPreferences: {}});
function sharedFixture(data: unknown = {}) {
  let value = structuredClone(data);
  return {loadData: async () => structuredClone(value), saveData: vi.fn(async (next: unknown) => {value = structuredClone(next);})};
}
it("gives devices independent identities and commands while sharing only preferences", async () => {
  const shared = sharedFixture({agentlensSettings: {folder: "Notes"}});
  const a = new PluginStateStore(new DeviceLocalPluginDataAdapter(shared, new IndexedDeviceLocalState("a"), () => initial("install-a"), async () => false));
  const b = new PluginStateStore(new DeviceLocalPluginDataAdapter(shared, new IndexedDeviceLocalState("b"), () => initial("install-b"), async () => false));
  expect((await a.load()).installationId).toBe("install-a"); expect((await b.load()).installationId).toBe("install-b");
  await a.update(s => {s.followConfigurationOutbox = [{id: "cmd", owner: "owner", installationId: "install-a", followId: "follow", kind: "delete"}];});
  expect((await b.load()).followConfigurationOutbox).toBeUndefined();
  expect(await shared.loadData()).toEqual({agentlensSettings: {folder: "Notes"}});
  const reopened = new PluginStateStore(new DeviceLocalPluginDataAdapter(shared, new IndexedDeviceLocalState("a"), () => initial("wrong"), async () => false));
  expect((await reopened.load()).followConfigurationOutbox).toHaveLength(1);
});
it("keeps legacy execution evidence unchanged and requires affirmative migration ownership", async () => {
  const legacy = {...initial("old"), pendingActions: [{id: "old-op", kind: "remote_action", createdAt: "now", payload: {id: "original"}}]};
  const shared = sharedFixture({agentlensState: legacy, preference: "old"});
  const local = new IndexedDeviceLocalState("migration");
  const adapter = new DeviceLocalPluginDataAdapter(shared, local, () => initial("new"), async () => false);
  await expect(adapter.loadData()).rejects.toThrow("Verify"); expect(await local.read()).toBeUndefined();
  const owned = new PluginStateStore(new DeviceLocalPluginDataAdapter(shared, local, () => initial("new"), async value => JSON.stringify(value) === JSON.stringify(legacy)));
  expect((await owned.load()).installationId).toBe("old");
  await owned.patchUiPreferences({recentFolder: "New"});
  expect((await shared.loadData() as {agentlensState: unknown}).agentlensState).toEqual(legacy);
  expect((await owned.load()).pendingActions).toEqual(legacy.pendingActions);
});
it("does not fall back to copied shared identity when a local record is damaged", async () => {
  const local = new IndexedDeviceLocalState("broken"); await local.commit(undefined, null);
  const shared = sharedFixture({agentlensState: initial("foreign")});
  await expect(new DeviceLocalPluginDataAdapter(shared, local, () => initial("new"), async () => true).loadData()).rejects.toThrow("Retain");
  expect(await local.read()).toEqual({version: 1, revision: 1, state: null});
});
it("does not report migration success when local persistence fails", async () => {
  const shared = sharedFixture({agentlensState: initial("old")});
  const write = vi.fn(async () => {throw new Error("quota");});
  await expect(new DeviceLocalPluginDataAdapter(shared, {read: async () => undefined, commit: write}, () => initial("new"), async () => true).loadData()).rejects.toThrow("quota");
  expect(shared.saveData).not.toHaveBeenCalled();
});

it("does not overwrite an initialized identity or silently lose a concurrent edit", async () => {
  const local = new IndexedDeviceLocalState("concurrent");
  const [a, b] = await Promise.all([local.commit(undefined, initial("a")), local.commit(undefined, initial("b"))]);
  expect(a).toEqual(b);
  const outcomes = await Promise.allSettled([local.commit(1, initial("a-edit")), local.commit(1, initial("b-edit"))]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
  expect((await local.read())?.revision).toBe(2);
});

it("rejects stale adapter saves and preserves the accepted command across reopening", async () => {
  const shared = sharedFixture();
  const adapter = () => new DeviceLocalPluginDataAdapter(shared, new IndexedDeviceLocalState("stale-save"), () => initial("original"), async () => false);
  const a = adapter(); const b = adapter();
  const first = await a.loadData() as Record<string, unknown>;
  const stale = await b.loadData() as Record<string, unknown>;
  const command = {id: "accepted", owner: "owner", installationId: "original", followId: "follow", kind: "delete"};
  (first.agentlensState as Record<string, unknown>).followConfigurationOutbox = [command];
  await a.saveData(first);
  await expect(b.saveData(stale)).rejects.toThrow("changed concurrently");
  const reopened = new PluginStateStore(adapter());
  expect((await reopened.load()).followConfigurationOutbox).toEqual([command]);
  expect(await shared.loadData()).toEqual({});
});
