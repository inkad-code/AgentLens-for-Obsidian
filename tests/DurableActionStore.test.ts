import { AgentLensError } from "@/core/errors";
import { describe, expect, it } from "vitest";
import { DurableActionStore } from "@/workbench/DurableActionStore";
import { PluginStateStore } from "@/runtime/PluginStateStore";

function fixture() {
  let data: unknown = {};
  let fail = false;
  let sequence = 0;
  const state = new PluginStateStore({
    async loadData() { return structuredClone(data); },
    async saveData(value) { if (fail) throw new Error("disk unavailable"); data = structuredClone(value); }
  }, () => "installation");
  const store = new DurableActionStore(state, () => `action-${++sequence}`);
  return { state, store, failWrites(value: boolean) { fail = value; } };
}
const preview = { demo: false, fetchId: "fetch-1", post: {
  platform: "youtube", contentId: "post-1", canonicalUrl: "https://youtube.com/watch?v=post-1",
  text: "Source", author: { id: "creator", displayName: "Creator" }, media: []
} };
const options = { folderPath: "Research", templateId: "default", mediaPolicy: "link_only" } as const;
const request = { runId: "run-1", fetchId: "fetch-1", results: [{ contentKey: "youtube:post-1", notePath: "Research/post.md", status: "success" as const }] };

describe("Durable recovery handoff", () => {
  it("retains a failed continuation identity across restart and clears it after success", async () => {
    const { store, state } = fixture();
    const first = await store.getOrCreateRemoteAction("profile:url:cursor", "profile");
    await expect(store.runRemoteAction("profile:url:cursor", "profile", async () => {
      throw new AgentLensError("unknown", "Invalid cursor", false, 400);
    }, { retainIdentityOnFailure: true })).rejects.toThrow("Invalid cursor");
    const restarted = new DurableActionStore(state, () => "new-action");
    await restarted.runRemoteAction("profile:url:cursor", "profile", async action => {
      expect(action).toEqual(first);
      return "next page";
    }, { retainIdentityOnFailure: true });
    expect((await state.load()).pendingActions).toHaveLength(0);
  });

  it("retains an unknown-result identity even when server retryable is false", async () => {
    const { store } = fixture();
    const first = await store.getOrCreateRemoteAction("single:url", "single");
    await expect(store.runRemoteAction("single:url", "single", async () => {
      throw new AgentLensError("unknown", "Reconcile", false, 409, undefined, "request", {failureClass: "reconciliation_required"});
    })).rejects.toThrow("Reconcile");
    expect(await store.getOrCreateRemoteAction("single:url", "single")).toEqual(first);
  });

  it("atomically replaces completed write intents with a replayable receipt", async () => {
    const { state, store } = fixture();
    const completed = await store.prepareWrite(preview, options, request, "write-1");
    const unfinished = await store.prepareWrite(preview, options, request, "write-2");
    await store.queueCallback(request, "receipt-1", [completed]);
    expect((await store.pendingWrites()).map((item) => item.id)).toEqual([unfinished]);
    expect(await store.pendingCallbacks()).toHaveLength(1);
    expect((await state.load()).pendingActions).toHaveLength(2);
    await store.queueCallback(request, "receipt-1", [completed]);
    expect(await store.pendingCallbacks()).toHaveLength(1);
  });

  it("keeps write intent after a failed receipt persistence and allows restart recovery", async () => {
    const fixtureValue = fixture();
    const id = await fixtureValue.store.prepareWrite(preview, options, request, "write-1");
    fixtureValue.failWrites(true);
    await expect(fixtureValue.store.queueCallback(request, "receipt-1", [id])).rejects.toThrow("disk unavailable");
    fixtureValue.failWrites(false);
    const restarted = new DurableActionStore(fixtureValue.state, () => "restarted");
    expect((await restarted.pendingWrites()).map((item) => item.id)).toEqual([id]);
    expect(await restarted.pendingCallbacks()).toEqual([]);
    await restarted.queueCallback(request, "receipt-1", [id]);
    expect(await restarted.pendingWrites()).toEqual([]);
    expect(await restarted.pendingCallbacks()).toHaveLength(1);
  });

  it("rejects new work at capacity without evicting unacknowledged receipts", async () => {
    const { state, store } = fixture();
    await state.update((value) => {
      value.pendingActions = Array.from({ length: 500 }, (_, index) => ({
        id: `receipt-${index}`, kind: "result_callback", createdAt: "2026-09-12T00:00:00Z",
        payload: { request, idempotencyKey: `receipt-${index}` }
      }));
    });
    await expect(store.prepareWrite(preview, options)).rejects.toThrow("queue is full");
    const callbacks = await store.pendingCallbacks();
    expect(callbacks).toHaveLength(500);
    expect(callbacks[0]?.id).toBe("receipt-0");
    await store.queueCallback(request, "receipt-0");
    expect(await store.pendingCallbacks()).toHaveLength(500);
  });
});
