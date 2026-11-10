import "fake-indexeddb/auto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { OperationStore, type SourceOperation } from "@/auto-fetch/operation-store";
import { creatorStatus } from "@/ui/workbench/creatorStatusProjection";
import type { CreatorRecord, CreatorUpdatePage } from "@/api/AgentLensApiClient";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
const scope = { userId: "owner", installationId: "vault", creatorId: "creator" };
const at = "2026-10-19T00:00:00Z", later = "2026-10-19T01:00:00Z";
const creator = { creatorId: "creator", saveFolderPath: "Research", platform: "youtube", autoFetchEnabled: true,
  displayName: "Creator", profileUrl: "https://example.com/creator", frequency: { every: 1, unit: "hour" },
  preferredTimes: [], timezone: "UTC", schedulerState: "failed", handle: null, avatarUrl: null, noteTemplateId: "default", mediaPolicy: "link_only",
  nextCheckAt: null, lastCheckedAt: null, lastUpdateAt: null, lastResult: null, lastError: null, importedCount: 0,
  retryAt: null, activeJobId: null, activeJobTrigger: null } satisfies CreatorRecord;
async function fixture() {
  const store = new OperationStore("presentation");
  const operations = ["old", "new", "queued"].map(operationId => ({ operationId, admissionKey: operationId,
    configRevision: 1, trigger: "normal", coverage: [], queuedAt: at, attempts: 0, status: "queued", version: 0,
    snapshot: creator }) as SourceOperation);
  await store.admit(scope, undefined, { configRevision: 1, observedThrough: at }, operations);
  return store;
}
async function start(store: OperationStore, id: string, dispatchedAt = at) {
  return (await store.transition(scope, id, 0, { status: "running", executionStartedAt: dispatchedAt,
    dispatchedAt, attemptKey: `attempt-${id}`, attempts: 1 }))!;
}
function page(id: string, patch: Partial<CreatorUpdatePage> = {}): CreatorUpdatePage {
  return { creatorId: "creator", fetchRunId: id, leaseId: id, fetchId: `fetch-${id}`, requestId: "request", previews: [],
    serverCheckedAt: later, hasMore: false, cursor: null, coverageComplete: true, truncated: false, stopReason: null, ...patch };
}
async function status(store: OperationStore) {
  return creatorStatus({ ...creator, localStatus: await store.creatorStatus(scope, "Research") });
}

it("keeps newest source state while accepting an older run's later complete check", async () => {
  const store = await fixture();
  await start(store, "old"); await start(store, "new");
  await store.transition(scope, "new", 1, { status: "failed", errorMessage: "New failure" });
  await store.acceptPage(scope, "old", 1, page("old"), later);
  expect(await store.creatorStatus(scope, "Research")).toMatchObject({ runState: "failed", lastError: "New failure",
    lastFetchRunSequence: 2, lastSuccessfulCheckAt: later, saveQueued: true, checkQueued: true });
  expect((await status(store)).mainStatus).toBe("failed");
  expect(await store.creatorStatus({ ...scope, userId: "other" }, "Research")).toEqual({});
  expect(await store.creatorStatus(scope, "Other")).not.toMatchObject({ saveQueued: true, checkQueued: true });
});

it("does not call a partial or truncated source page a successful check", async () => {
  const store = await fixture(); await start(store, "old");
  await store.acceptPage(scope, "old", 1, page("old", { hasMore: true, cursor: "next", coverageComplete: false }), at);
  expect((await store.creatorStatus(scope, "Research")).lastSuccessfulCheckAt).toBeUndefined();
  const running = await store.transition(scope, "old", 2, { status: "running", dispatchedAt: later, attemptKey: "page-2" });
  await store.acceptPage(scope, "old", running!.version, page("old", { fetchId: "fetch-old-page-2", truncated: true }), later);
  expect(await store.creatorStatus(scope, "Research")).toMatchObject({ runState: "failed" });
  expect((await store.creatorStatus(scope, "Research")).lastSuccessfulCheckAt).toBeUndefined();
});

it("resuming suppresses old failures without deleting tasks and a later old queued start supersedes it", async () => {
  const store = await fixture(); await start(store, "new");
  await store.transition(scope, "new", 1, { status: "failed", errorMessage: "Old failure" });
  await store.resetCreatorStatus(scope, later);
  expect(await status(store)).toMatchObject({ mainStatus: "scheduled", subStatus: "resumed" });
  expect((await store.get(scope, "new"))?.status).toBe("failed");
  const reopened = new OperationStore("presentation");
  expect(await status(reopened)).toMatchObject({ subStatus: "resumed" });
  await start(reopened, "old", later);
  await reopened.resetCreatorStatus(scope, at); // Old schedule history must not reapply a reset.
  expect((await reopened.creatorStatus(scope, "Research")).statusResetSuperseded).toBe(true);
  expect((await status(reopened)).mainStatus).toBe("failed");
});

it("distinguishes unknown writes, failed writes and pending receipts without claiming live work", async () => {
  const store = await fixture(); await start(store, "new");
  await store.acceptPage(scope, "new", 1, page("new"), at);
  await store.beginPage(scope, "new", 1, 0, 0);
  await store.failPage(scope, "new", 1, 1, false, true);
  expect(await status(store)).toMatchObject({ mainStatus: "scheduled", subStatus: "verifying_write" });
  await store.settlePage(scope, "new", 1, 1);
  await store.queueCallback(scope, "receipt", { creatorId: "creator", fetchRunId: "new", runId: "new", fetchId: "fetch-new",
    runComplete: true, coverageComplete: true, truncated: false, results: [] });
  expect(await status(store)).toMatchObject({ mainStatus: "scheduled", subStatus: "receipt_pending" });
  const callback = (await store.callback(scope, "receipt"))!;
  await store.updateCallback(callback, { status: "acknowledged", attempts: 1, readyAt: 0 });
  expect(await status(store)).toMatchObject({ subStatus: "check_queued" });
  await start(store, "old"); await store.acceptPage(scope, "old", 1, page("old"), later);
  await store.beginPage(scope, "old", 1, 0, 0);
  await store.failPage(scope, "old", 1, 1, true);
  expect(await status(store)).toMatchObject({ mainStatus: "failed", subStatus: "write_failed" });
  expect(creatorStatus({ ...creator, autoFetchEnabled: false, localStatus: await store.creatorStatus(scope, "Research") },
    { importing: true })).toMatchObject({ mainStatus: "paused" });
});

it("rolls back the source projection together with a failed page transaction", async () => {
  const store = await fixture(); await start(store, "old");
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, ...args) {
    if (this.name === "creatorPresentation") throw new Error("presentation disk failure");
    return put.apply(this, args);
  });
  await expect(store.acceptPage(scope, "old", 1, page("old"), at)).rejects.toBeTruthy();
  failure.mockRestore();
  expect(await store.pendingPages(scope)).toEqual([]);
  expect((await store.get(scope, "old"))?.status).toBe("running");
  expect((await store.creatorStatus(scope, "Research")).lastSuccessfulCheckAt).toBeUndefined();
});

it("publishes only committed changes to local observers and releases subscriptions", async () => {
  const store = await fixture(), listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const secondWindow = new OperationStore("presentation");
  await start(secondWindow, "old");
  expect(listener).toHaveBeenCalledTimes(1);
  await secondWindow.creatorStatus(scope, "Research");
  expect(listener).toHaveBeenCalledTimes(1);
  await expect(secondWindow.transition(scope, "old", 1, { status: "cancelled", cancellationReason: "deleted" })).rejects.toThrow();
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  await secondWindow.acceptPage(scope, "old", 1, page("old"), at);
  expect(listener).toHaveBeenCalledTimes(1);
});
