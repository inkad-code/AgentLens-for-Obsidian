import { expect, it, vi } from "vitest";
import { FollowConfigurationOutbox } from "../src/runtime/FollowConfigurationOutbox";
import { FollowConfigurationSync } from "../src/runtime/FollowConfigurationSync";
import { PluginStateStore } from "../src/runtime/PluginStateStore";
import type { AgentLensApiPort } from "../src/workbench/ports";
function fixture() {
  let data: unknown; let fail = false; let sequence = 0;
  const store = new PluginStateStore({ loadData: async () => structuredClone(data), saveData: async value => {
    if (fail) throw new Error("disk"); data = structuredClone(value);
  } }, () => "installation");
  const outbox = new FollowConfigurationOutbox(store, () => `command-${++sequence}`);
  const patchAccountFollow = vi.fn<NonNullable<AgentLensApiPort["patchAccountFollow"]>>(async () => undefined);
  const api = { patchAccountFollow } as unknown as AgentLensApiPort;
  return { store, outbox, api, patchAccountFollow, fail: (value: boolean) => { fail = value; } };
}
it("persists ordered offline changes without executing and drains only the current account", async () => {
  const f = fixture();
  await f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
  await f.outbox.enqueue("other", "follow", {configRevision: 1, autoFetchEnabled: true});
  await f.outbox.enqueue("owner", "follow", {configRevision: 1, frequency: {every: 6, unit: "hour"}});
  expect(f.patchAccountFollow).not.toHaveBeenCalled();
  await new FollowConfigurationOutbox(f.store).flush(f.api, "owner", "token", async () => true);
  expect(f.patchAccountFollow.mock.calls).toEqual([
    ["token", "follow", {configRevision: 1, autoFetchEnabled: false}, "command-1"],
    ["token", "follow", {configRevision: 1, frequency: {every: 6, unit: "hour"}}, "command-3"]]);
  expect((await f.store.load()).followConfigurationOutbox?.map(c => c.owner)).toEqual(["other"]);
});
it("retains the original key after an unknown response or failed acknowledgement save", async () => {
  const f = fixture(); await f.outbox.enqueue("owner", "follow", {configRevision: 2, autoFetchEnabled: false});
  f.patchAccountFollow.mockRejectedValueOnce(new Error("offline"));
  await expect(f.outbox.flush(f.api, "owner", "token", async () => true)).rejects.toThrow("offline");
  f.fail(true);
  await expect(f.outbox.flush(f.api, "owner", "token", async () => true)).rejects.toThrow("disk");
  f.fail(false);
  await f.outbox.flush(f.api, "owner", "token", async () => true);
  expect(f.patchAccountFollow.mock.calls.map(c => c[3])).toEqual(["command-1", "command-1", "command-1"]);
  expect((await f.store.load()).followConfigurationOutbox).toEqual([]);
});
it("retains a late response after account change and never sends foreign-installation commands", async () => {
  const f = fixture(); await f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
  let current = true; f.patchAccountFollow.mockImplementationOnce(async () => { current = false; });
  await expect(f.outbox.flush(f.api, "owner", "token", async () => current)).rejects.toThrow("session");
  expect((await f.store.load()).followConfigurationOutbox).toHaveLength(1);
  await f.store.update(s => { s.installationId = "replacement"; });
  await f.outbox.flush(f.api, "owner", "token", async () => true);
  expect(f.patchAccountFollow).toHaveBeenCalledTimes(1);
});
it("blocks authority synchronization while a queued configuration cannot be submitted", async () => {
  const f = fixture(); await f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
  const followChanges = vi.fn(); f.api.followChanges = followChanges;
  f.patchAccountFollow.mockRejectedValueOnce(new Error("offline"));
  await expect(new FollowConfigurationSync(f.api, f.store).run("owner", "token", async () => true)).rejects.toThrow("offline");
  expect(followChanges).not.toHaveBeenCalled(); expect((await f.store.load()).followSync).toBeUndefined();
});
it("does not send after failed enqueue and rejects fixed-anchor changes", async () => {
  const f = fixture(); await f.store.load(); f.fail(true);
  await expect(f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false})).rejects.toThrow("disk");
  f.fail(false);
  await expect(f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false, fixedAnchor: "other"} as never)).rejects.toThrow("Invalid");
  await f.outbox.flush(f.api, "owner", "token", async () => true); expect(f.patchAccountFollow).not.toHaveBeenCalled();
});
it("submits edits before deletion and preserves execution evidence across acknowledgement", async () => {
  const f = fixture(); const order: string[] = [];
  await f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
  await f.outbox.enqueueDelete("owner", "follow");
  await f.store.update(s => { s.schedulerSequence = 99; s.creatorDiagnostics.original = {lastSavedAt: "yesterday", lastSavedCount: 2, lastSavedFetchRunId: "run", countedPages: ["page"]}; });
  f.patchAccountFollow.mockImplementation(async () => { order.push("patch"); });
  f.api.deleteAccountFollowCommand = vi.fn(async (_token, _follow, key) => { order.push(`delete:${key}`); });
  await new FollowConfigurationOutbox(f.store).flush(f.api, "owner", "token", async () => true);
  expect(order).toEqual(["patch", "delete:command-2"]);
  const state = await f.store.load(); expect(state.followConfigurationOutbox).toEqual([]);
  expect(state.schedulerSequence).toBe(99); expect(state.creatorDiagnostics.original?.countedPages).toEqual(["page"]);
});
it("keeps an unknown delete under the same key and rejects edits behind a pending tombstone", async () => {
  const f = fixture(); await f.outbox.enqueueDelete("owner", "follow");
  await expect(f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: true})).rejects.toThrow("deletion");
  await expect(f.outbox.enqueueDelete("owner", "follow")).rejects.toThrow("deletion");
  const send = vi.fn<NonNullable<AgentLensApiPort["deleteAccountFollowCommand"]>>().mockRejectedValueOnce(new Error("unknown")).mockResolvedValue(undefined);
  f.api.deleteAccountFollowCommand = send;
  await expect(f.outbox.flush(f.api, "owner", "token", async () => true)).rejects.toThrow("unknown");
  expect((await f.store.load()).followConfigurationOutbox).toHaveLength(1);
  await new FollowConfigurationOutbox(f.store).flush(f.api, "owner", "token", async () => true);
  expect(send.mock.calls).toEqual([["token", "follow", "command-1"], ["token", "follow", "command-1"]]);
});
it("retains delete on unsupported transport or a late account response", async () => {
  const f = fixture(); await f.outbox.enqueueDelete("owner", "follow");
  await expect(f.outbox.flush(f.api, "owner", "token", async () => true)).rejects.toThrow("unavailable");
  let current = true;
  f.api.deleteAccountFollowCommand = vi.fn(async () => { current = false; });
  await expect(f.outbox.flush(f.api, "owner", "token", async () => current)).rejects.toThrow("session");
  expect((await f.store.load()).followConfigurationOutbox).toHaveLength(1);
});
const tombstoneRevision = (revision: number, deleted = false) => ({revision, effectiveAt: "2026-10-30T00:00:00Z", anchorAt: "2026-10-29T00:00:00Z", frequencyEvery: 6, frequencyUnit: "hour" as const, autoFetchEnabled: !deleted, deleted, legacySnapshot: false});
async function removedError() {
  const { AgentLensError } = await import("../src/core/errors");
  return new AgentLensError("unknown", "removed", false, 409, undefined, undefined, undefined, "FOLLOW_DELETED");
}
it("resolves a stale edit only against complete pinned tombstone history and retains its audit", async () => {
  const f = fixture(); await f.outbox.enqueue("owner", "deleted-follow", {configRevision: 1, autoFetchEnabled: true});
  await f.outbox.enqueue("owner", "next-follow", {configRevision: 1, autoFetchEnabled: false});
  f.patchAccountFollow.mockRejectedValueOnce(await removedError());
  const history = vi.fn<AgentLensApiPort["scheduleHistory"]>()
    .mockResolvedValueOnce({followId: "deleted-follow", throughRevision: 2, revisions: [tombstoneRevision(1)], nextAfterRevision: 1})
    .mockResolvedValueOnce({followId: "deleted-follow", throughRevision: 2, revisions: [tombstoneRevision(2, true)], nextAfterRevision: null});
  f.api.scheduleHistory = history;
  await f.outbox.flush(f.api, "owner", "token", async () => true);
  expect(history.mock.calls).toEqual([["token", "deleted-follow", 0, undefined], ["token", "deleted-follow", 1, 2]]);
  const retained = (await f.store.load()).followConfigurationOutbox!;
  expect(retained).toHaveLength(1);
  expect(retained[0]).toMatchObject({id: "command-1", followId: "deleted-follow", patch: {autoFetchEnabled: true}, resolution: {state: "superseded_by_deletion", revision: 2}});
  await new FollowConfigurationOutbox(f.store).flush(f.api, "owner", "token", async () => true);
  expect(f.patchAccountFollow).toHaveBeenCalledTimes(2);
});
it("does not discard a command on missing, live, foreign or incomplete deletion history", async () => {
  for (const page of [
    {followId: "follow", throughRevision: 1, revisions: [tombstoneRevision(1)], nextAfterRevision: null},
    {followId: "other", throughRevision: 1, revisions: [tombstoneRevision(1, true)], nextAfterRevision: null},
    {followId: "follow", throughRevision: 2, revisions: [tombstoneRevision(2, true)], nextAfterRevision: null},
    {followId: "follow", throughRevision: 1, revisions: [{...tombstoneRevision(1, true), legacySnapshot: true}], nextAfterRevision: null}
  ]) {
    const f = fixture(); await f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
    f.patchAccountFollow.mockRejectedValueOnce(await removedError());
    f.api.scheduleHistory = vi.fn().mockResolvedValue(page);
    await expect(f.outbox.flush(f.api, "owner", "token", async () => true)).rejects.toThrow();
    expect((await f.store.load()).followConfigurationOutbox?.[0]?.resolution).toBeUndefined();
  }
});
it("does not treat an ordinary 404 as deletion evidence", async () => {
  const f = fixture(); await f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
  const { AgentLensError } = await import("../src/core/errors");
  f.patchAccountFollow.mockRejectedValueOnce(new AgentLensError("unknown", "missing", false, 404, undefined, undefined, undefined, "FOLLOW_NOT_FOUND"));
  f.api.scheduleHistory = vi.fn();
  await expect(f.outbox.flush(f.api, "owner", "token", async () => true)).rejects.toThrow("missing");
  expect(f.api.scheduleHistory).not.toHaveBeenCalled();
  expect((await f.store.load()).followConfigurationOutbox?.[0]?.resolution).toBeUndefined();
});
it("retains unresolved deletion when the session changes during history verification", async () => {
  const f = fixture(); await f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
  f.patchAccountFollow.mockRejectedValueOnce(await removedError()); let current = true;
  f.api.scheduleHistory = vi.fn(async () => { current = false; return {followId: "follow", throughRevision: 1, revisions: [tombstoneRevision(1, true)], nextAfterRevision: null}; });
  await expect(f.outbox.flush(f.api, "owner", "token", async () => current)).rejects.toThrow("session");
  expect((await f.store.load()).followConfigurationOutbox?.[0]?.resolution).toBeUndefined();
});
it("does not advance to later commands until the tombstone resolution is durably saved", async () => {
  const f = fixture(); await f.outbox.enqueue("owner", "follow", {configRevision: 1, autoFetchEnabled: false});
  await f.outbox.enqueue("owner", "next", {configRevision: 1, autoFetchEnabled: false});
  f.patchAccountFollow.mockRejectedValueOnce(await removedError());
  f.api.scheduleHistory = vi.fn().mockResolvedValue({followId: "follow", throughRevision: 1, revisions: [tombstoneRevision(1, true)], nextAfterRevision: null});
  f.fail(true);
  await expect(f.outbox.flush(f.api, "owner", "token", async () => true)).rejects.toThrow("disk");
  f.fail(false);
  expect(f.patchAccountFollow).toHaveBeenCalledOnce();
  expect((await f.store.load()).followConfigurationOutbox?.[0]?.resolution).toBeUndefined();
  expect((await f.store.load()).followConfigurationOutbox).toHaveLength(2);
});

it("blocks concurrent UI edits durably without changing authoritative execution fields", async () => {
  const f = fixture(); const before = await f.store.load();
  const results = await Promise.allSettled([
    f.outbox.enqueue("owner", "follow", {configRevision: 1, frequency: {every: 2, unit: "week"}}, true),
    f.outbox.enqueueDelete("owner", "follow", true)
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  await expect(new FollowConfigurationOutbox(f.store).enqueueDelete("owner", "follow", true)).rejects.toThrow("pending");
  const after = await f.store.load(); expect(after.followConfigurationOutbox).toHaveLength(1);
  delete after.followConfigurationOutbox; delete before.followConfigurationOutbox;
  expect(after).toEqual(before);
});
