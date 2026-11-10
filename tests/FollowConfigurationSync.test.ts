import { expect, it, vi } from "vitest";
import { FollowConfigurationSync } from "../src/runtime/FollowConfigurationSync";
import { PluginStateStore } from "../src/runtime/PluginStateStore";
import { validateFollowChanges } from "../src/api/followSync";
import type { AgentLensApiPort } from "../src/workbench/ports";

const revision = (n: number, deleted = false) => ({ revision: n, effectiveAt: "2026-10-30T00:00:00Z",
  anchorAt: "2026-10-29T00:00:00Z", frequencyEvery: 6, frequencyUnit: "hour", autoFetchEnabled: !deleted, deleted, legacySnapshot: false });
function fixture() {
  let data: unknown;
  let failSave = false;
  const store = new PluginStateStore({ loadData: async () => structuredClone(data), saveData: async value => {
    if (failSave) throw new Error("disk unavailable"); data = structuredClone(value);
  } }, () => "installation");
  const api = { followChanges: vi.fn().mockResolvedValue({ throughEventId: 4, nextAfterEventId: 4, hasMore: false,
    changes: [{ eventId: 4, followId: "follow", configRevision: 2, eventType: "follow_config_changed" }] }),
    accountFollows: vi.fn().mockResolvedValue([{ followId: "follow", configRevision: 2 }]),
    scheduleHistory: vi.fn().mockImplementation(async (_token, followId, _after, through) => ({ followId,
      throughRevision: through, revisions: Array.from({ length: through }, (_, i) => revision(i + 1)), nextAfterRevision: null })) };
  const sync = new FollowConfigurationSync(api as unknown as AgentLensApiPort, store);
  const key = JSON.stringify(["owner", "installation", "obsidian"]);
  return { store, api, sync, key, failSave: (v: boolean) => { failSave = v; } };
}
it("commits authoritative configuration with the cursor without changing execution evidence", async () => {
  const f = fixture();
  await f.store.load();
  await f.store.update(s => { s.schedulerSequence = 75; s.creatorDiagnostics = { original: { lastSavedAt: "today", lastSavedCount: 4,
    lastSavedFetchRunId: "original", countedPages: ["page"] } }; });
  await f.sync.run("owner", "token", async () => true);
  const state = await f.store.load();
  expect(state.followSync?.[f.key]).toEqual({ after: 4, configurations: { follow: revision(2) } });
  expect(state.schedulerSequence).toBe(75);
  expect(state.creatorDiagnostics.original?.countedPages).toEqual(["page"]);
  expect(f.api.accountFollows).toHaveBeenCalledOnce();
  await expect(f.sync.run("owner", "token", async () => true)).rejects.toThrow("Invalid configuration");
  expect((await f.store.load()).followSync?.[f.key]?.after).toBe(4);
});
it("resumes a stable boundary after restart and retains tombstones", async () => {
  const f = fixture();
  f.api.followChanges.mockResolvedValueOnce({ throughEventId: 9, nextAfterEventId: 4, hasMore: true,
    changes: [{ eventId: 4, followId: "follow", configRevision: 2, eventType: "follow_config_changed" }] });
  expect(await f.sync.run("owner", "token", async () => true)).toBe(false);
  f.api.followChanges.mockResolvedValueOnce({ throughEventId: 9, nextAfterEventId: 9, hasMore: false,
    changes: [{ eventId: 9, followId: "follow", configRevision: 3, eventType: "follow_deleted" }] });
  f.api.scheduleHistory.mockResolvedValueOnce({ followId: "follow", throughRevision: 3,
    revisions: [revision(1), revision(2), revision(3, true)], nextAfterRevision: null });
  expect(await new FollowConfigurationSync(f.api as unknown as AgentLensApiPort, f.store).run("owner", "token", async () => true)).toBe(true);
  expect(f.api.followChanges).toHaveBeenLastCalledWith("token", 4, 9);
  expect((await f.store.load()).followSync?.[f.key]).toEqual({ after: 9, configurations: { follow: revision(3, true) } });
});
it("does not advance on incomplete history or storage failure", async () => {
  const f = fixture(); await f.store.load();
  f.api.scheduleHistory.mockResolvedValueOnce({ followId: "follow", throughRevision: 2, revisions: [revision(2)], nextAfterRevision: null });
  await expect(f.sync.run("owner", "token", async () => true)).rejects.toThrow("history");
  expect((await f.store.load()).followSync).toBeUndefined();
  f.failSave(true);
  await expect(f.sync.run("owner", "token", async () => true)).rejects.toThrow("disk");
  f.failSave(false);
  expect((await f.store.load()).followSync).toBeUndefined();
  await f.sync.run("owner", "token", async () => true);
  expect(f.api.followChanges.mock.calls.every(c => c[1] === 0)).toBe(true);
});
it("rejects a late account response and keeps each account cursor independent", async () => {
  const f = fixture(); let current = true;
  f.api.accountFollows.mockImplementationOnce(async () => { current = false; return []; });
  await expect(f.sync.run("owner", "token", async () => current)).rejects.toThrow("session changed");
  expect((await f.store.load()).followSync).toBeUndefined();
  await f.sync.run("owner", "token", async () => true);
  await f.sync.run("other", "other-token", async () => true);
  expect(f.api.followChanges).toHaveBeenLastCalledWith("other-token", 0, undefined);
  expect(Object.keys((await f.store.load()).followSync!)).toHaveLength(2);
});
it("rejects cursor jumps, changed boundaries, unordered hints and unsupported events", () => {
  const base = { throughEventId: 8, nextAfterEventId: 8, hasMore: false, changes: [] };
  expect(validateFollowChanges(base, 4)).toEqual(base);
  for (const value of [{ ...base, nextAfterEventId: 9 }, { ...base, hasMore: true },
    { ...base, changes: [{ eventId: 3, followId: "f", configRevision: 1, eventType: "follow_deleted" }] },
    { ...base, changes: [{ eventId: 7, followId: "f", configRevision: 1, eventType: "execute" }] }])
    expect(() => validateFollowChanges(value, 4)).toThrow();
  expect(() => validateFollowChanges(base, 4, 9)).toThrow();
});
it.each([null, [{ followId: "", configRevision: 1 }], [{ followId: "f", configRevision: 0 }],
  [{ followId: "f", configRevision: 1 }, { followId: "f", configRevision: 2 }]])(
  "retains the cursor when the initial authoritative list is invalid: %j", async follows => {
    const f=fixture();f.api.accountFollows.mockResolvedValueOnce(follows);
    await expect(f.sync.run("owner","token",async()=>true)).rejects.toThrow("authoritative follow");
    expect((await f.store.load()).followSync).toBeUndefined();
  });

it("does not admit scheduling when a local edit arrives while authority history is being read", async () => {
  const f = fixture();
  f.api.accountFollows.mockImplementationOnce(async () => {
    const { FollowConfigurationOutbox } = await import("../src/runtime/FollowConfigurationOutbox");
    await new FollowConfigurationOutbox(f.store, () => "edit-during-sync").enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
    return [{followId: "follow", configRevision: 2}];
  });
  await expect(f.sync.run("owner", "token", async () => true)).rejects.toThrow("arrived during");
  expect((await f.store.load()).followConfigurationOutbox).toHaveLength(1);
});

it.each([null, "follow", 1, { followId: "follow", configRevision: "2" }])("rejects malformed authoritative rows before advancing the checkpoint (%j)", async row => {
  const f = fixture();
  f.api.accountFollows.mockResolvedValue([row] as never);
  await expect(f.sync.run("owner", "token", async () => true)).rejects.toThrow("Invalid authoritative follow");
  expect((await f.store.load()).followSync?.[f.key]).toBeUndefined();
  expect(f.api.scheduleHistory).not.toHaveBeenCalled();
});
