import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { OperationStore } from "@/auto-fetch/operation-store";
import { CallbackDispatcher } from "@/auto-fetch/callback-dispatcher";
import type { SchedulerSession } from "@/auto-fetch/indexed-scheduler";
import type { WriteResultsRequest } from "@/api/AgentLensApiClient";
import { RequestCoordinator } from "@/runtime/RequestCoordinator";
import { AgentLensError } from "@/core/errors";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
const scope = { userId: "user", installationId: "vault", creatorId: "creator" };
const request: WriteResultsRequest = { creatorId: "creator", fetchId: "fetch", fetchRunId: "run", runId: "run",
  writeAttemptId: "run:fetch:1", runComplete: true, coverageComplete: true, truncated: false,
  results: [{ contentKey: "youtube:post", notePath: "Research/post.md", status: "success" }] };
function fixture() {
  const store = new OperationStore("callbacks");
  let now = 100_000;
  let session: SchedulerSession | undefined = { ...scope, accessToken: "token", epoch: 1, sequenceFloor: 0 };
  const writeResults = vi.fn(async () => ({ accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 }));
  const dependencies = { store, requests: new RequestCoordinator(), api: { writeResults }, session: async () => session, now: () => now };
  return { store, dependencies, writeResults, dispatcher: new CallbackDispatcher(dependencies),
    advance(ms: number) { now += ms; }, session(value: SchedulerSession | undefined) { session = value; } };
}

it("replays exactly the original payload/key after restart with persisted backoff", async () => {
  const f = fixture();
  await f.store.queueCallback(scope, "receipt", request);
  f.writeResults.mockRejectedValueOnce(new Error("connection lost"));
  expect(await f.dispatcher.flush()).toBe(0);
  expect(await new CallbackDispatcher(f.dependencies).flush()).toBe(0);
  expect(f.writeResults).toHaveBeenCalledTimes(1);
  f.advance(60_000);
  expect(await new CallbackDispatcher(f.dependencies).flush()).toBe(1);
  expect(f.writeResults.mock.calls[1]).toEqual(f.writeResults.mock.calls[0]);
  expect(await f.store.callback(scope, "receipt")).toMatchObject({ status: "acknowledged", attempts: 2 });
  expect(await f.dispatcher.flush()).toBe(0);
});

it("does not deliver another account, installation, or namespace's callbacks", async () => {
  const f = fixture();
  await f.store.queueCallback({ ...scope, userId: "other" }, "receipt", request);
  await f.store.queueCallback({ ...scope, installationId: "other" }, "receipt", request);
  await new OperationStore("other").queueCallback(scope, "receipt", request);
  expect(await f.dispatcher.flush()).toBe(0);
  expect(f.writeResults).not.toHaveBeenCalled();
});

it("keeps a late acknowledgement pending when the originating session changes", async () => {
  const f = fixture();
  await f.store.queueCallback(scope, "receipt", request);
  f.writeResults.mockImplementationOnce(async () => {
    f.session({ ...scope, accessToken: "new-token", epoch: 2, sequenceFloor: 0 });
    return { accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 };
  });
  expect(await f.dispatcher.flush()).toBe(0);
  expect(await f.store.callback(scope, "receipt")).toMatchObject({ status: "pending", attempts: 1 });
});

it("preserves immutable evidence and coalesces concurrent delivery", async () => {
  const f = fixture();
  const callback = await f.store.queueCallback(scope, "receipt", request);
  await expect(f.store.queueCallback(scope, "receipt", { ...request, results: [] })).rejects.toThrow("cannot change");
  await Promise.all([f.dispatcher.send(callback), new CallbackDispatcher(f.dependencies).send(callback)]);
  expect(f.writeResults).toHaveBeenCalledTimes(1);
  expect(await f.store.queueCallback(scope, "receipt", request)).toMatchObject({ status: "acknowledged" });
});

it("does not discard a partial acknowledgement or keep retrying a definitive conflict", async () => {
  const f = fixture();
  await f.store.queueCallback(scope, "partial", request);
  f.writeResults.mockResolvedValueOnce({ accepted: 0, success: 0, partial: 0, failed: 0, skipped: 0 });
  expect(await f.dispatcher.flush()).toBe(0);
  expect(await f.store.callback(scope, "partial")).toMatchObject({ status: "pending" });
  f.advance(60_000);
  f.writeResults.mockRejectedValueOnce(new AgentLensError("unknown", "Evidence conflict", false, 409));
  expect(await f.dispatcher.flush()).toBe(0);
  expect(await f.store.callback(scope, "partial")).toMatchObject({ status: "requires_reconciliation" });
  f.advance(86_400_000);
  expect(await f.dispatcher.flush()).toBe(0);
  expect(f.writeResults).toHaveBeenCalledTimes(2);
});

it("stores more than the old JSON cap and reads bounded pages", async () => {
  const f = fixture();
  for (let index = 0; index < 510; index++) await f.store.queueCallback(scope, `receipt-${String(index).padStart(3, "0")}`, request);
  expect(await f.store.dueCallbacks(scope, 100_000)).toHaveLength(25);
  expect(await f.dispatcher.flush()).toBe(25);
  expect(await f.store.dueCallbacks(scope, 100_000)).toHaveLength(25);
  expect(await new OperationStore("callbacks").callback(scope, "receipt-509")).toMatchObject({ request, status: "pending" });
});

it("a stale delivery cannot regress a newer acknowledgement", async () => {
  const f = fixture();
  const callback = await f.store.queueCallback(scope, "receipt", request);
  expect(await f.dispatcher.send(callback)).toBe(true);
  expect(await f.store.updateCallback(callback, { status: "pending", attempts: 3, readyAt: 0 })).toBeUndefined();
  expect(await f.store.callback(scope, "receipt")).toMatchObject({ status: "acknowledged" });
});
