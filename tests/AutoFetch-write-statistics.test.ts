import "fake-indexeddb/auto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { OperationStore, type SourceOperation } from "@/auto-fetch/operation-store";
import type { VaultWriteResult } from "@/vault/VaultWriter";
import type { WriteResultsRequest } from "@/api/AgentLensApiClient";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
const scope = { userId: "user", installationId: "vault", creatorId: "creator" };
const at = "2026-10-19T00:00:00Z";
async function fixture() {
  const store = new OperationStore("statistics");
  const operations = ["old", "new", "reused"].map(operationId => ({ operationId, admissionKey: operationId,
    configRevision: 1, trigger: "normal", coverage: [], queuedAt: at, attempts: 0, status: "queued", version: 0,
    snapshot: { creatorId: "creator", configRevision: 1, saveFolderPath: "Research", platform: "youtube", autoFetchEnabled: true,
      displayName: "Creator", profileUrl: "https://example.com/creator", frequency: { every: 1, unit: "hour" }, preferredTimes: [], timezone: "UTC" } }) as SourceOperation);
  await store.admit(scope, undefined, { configRevision: 1, observedThrough: at }, operations);
  return store;
}
function request(run: string, index = 0): WriteResultsRequest {
  return { creatorId: "creator", fetchRunId: run, runId: run, fetchId: `page-${index}`, writeAttemptId: `${run}:${index}:1`,
    runComplete: true, coverageComplete: true, truncated: false, results: [] };
}
function write(index = 0, action = "new"): VaultWriteResult {
  return { manifest: { action, contentKey: `youtube:${index}`, notePath: `Research/${index}.md` }, attachments: [],
    ledger: { contentKey: `youtube:${index}`, notePath: `Research/${index}.md`, writtenAt: at, completion: "complete" } } as unknown as VaultWriteResult;
}
it("retains dedup evidence beyond 50 pages and across restart", async () => {
  const store = await fixture();
  for (let index = 0; index < 120; index++) await store.commitWrite(scope, write(index), request("old", index), true);
  const reopened = new OperationStore("statistics");
  await reopened.commitWrite(scope, write(0), request("old", 0), true);
  expect(await reopened.runStatistics(scope, "old")).toMatchObject({ savedCount: 120, reusedCount: 0 });
  expect(await reopened.creatorStatistics(scope)).toMatchObject({ importedCount: 120, lastSavedCount: 120 });
  expect(await reopened.dueCallbacks(scope, Date.now())).toHaveLength(25);
});

it("keeps older late writes in their own run without replacing the newer card projection", async () => {
  const store = await fixture();
  await store.commitWrite(scope, write(1), request("new"), true);
  await store.commitWrite(scope, { ...write(2), ledger: { ...write(2).ledger, writtenAt: "2026-10-20T00:00:00Z" } }, request("old"), true);
  await store.commitWrite(scope, write(3, "skip"), request("reused"), false);
  expect(await store.creatorStatistics(scope)).toEqual({ importedCount: 2, lastSavedFetchRunId: "new",
    lastSavedRunSequence: 2, lastSavedAt: at, lastSavedCount: 1 });
  expect(await store.runStatistics(scope, "old")).toMatchObject({ savedCount: 1 });
  expect(await store.runStatistics(scope, "reused")).toMatchObject({ savedCount: 0, reusedCount: 1 });
});

it("counts partial note repair once while retaining its latest physical-save time", async () => {
  const store = await fixture();
  const partial = { ...write(), ledger: { ...write().ledger, completion: "partial" as const } };
  await store.commitWrite(scope, partial, request("old"), true);
  const repaired = { ...write(), ledger: { ...write().ledger, writtenAt: "2026-10-19T00:10:00Z" } };
  await store.commitWrite(scope, repaired, { ...request("old"), writeAttemptId: "old:0:2" }, true);
  expect(await store.creatorStatistics(scope)).toMatchObject({ importedCount: 1, lastSavedCount: 1, lastSavedAt: "2026-10-19T00:10:00Z" });
  expect(await store.dueCallbacks(scope, Date.now())).toHaveLength(2);
});

it("rolls back the receipt, summaries, ledger and callback together on persistence failure", async () => {
  const store = await fixture();
  const add = IDBObjectStore.prototype.add;
  const failure = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function(this: IDBObjectStore, ...args) {
    if (this.name === "callbacks") throw new Error("callback disk failure");
    return add.apply(this, args);
  });
  await expect(store.commitWrite(scope, write(), request("old"), true)).rejects.toThrow("callback disk failure");
  failure.mockRestore();
  expect(await store.creatorStatistics(scope)).toBeUndefined();
  expect(await store.runStatistics(scope, "old")).toBeUndefined();
  expect(await store.localLedger(scope, "youtube:0", "Research")).toBeUndefined();
  expect(await store.dueCallbacks(scope, Date.now())).toEqual([]);
  await store.commitWrite(scope, write(), request("old"), true);
  expect(await store.creatorStatistics(scope)).toMatchObject({ importedCount: 1 });
});

it("refuses to overwrite immutable callback evidence or attribute a foreign account's write", async () => {
  const store = await fixture();
  await store.commitWrite(scope, write(), request("old"), true);
  await expect(store.commitWrite(scope, { ...write(), ledger: { ...write().ledger, completion: "partial" } }, request("old"), true))
    .rejects.toThrow("cannot change");
  expect(await store.runStatistics(scope, "old")).toMatchObject({ savedCount: 1 });
  await expect(store.commitWrite({ ...scope, userId: "other" }, write(), request("old"), true)).rejects.toThrow("original destination");
  expect(await store.creatorStatistics({ ...scope, userId: "other" })).toBeUndefined();
});


it("replays a task's confirmed save as success, while a separate task records reuse", async () => {
  const store = await fixture();
  await store.commitWrite(scope, write(), request("old"), true);
  await store.commitWrite(scope, write(0, "skip"), { ...request("old"), writeAttemptId: "old:0:2" }, false);
  await store.commitWrite(scope, write(0, "skip"), request("new"), false);
  const callbacks = await store.dueCallbacks(scope, Date.now());
  expect(callbacks.find(item => item.request.writeAttemptId === "old:0:2")?.request.results[0]?.status).toBe("success");
  expect(callbacks.find(item => item.request.writeAttemptId === "new:0:1")?.request.results[0]?.status).toBe("skipped");
  expect(await store.creatorStatistics(scope)).toMatchObject({ importedCount: 1, lastSavedFetchRunId: "old" });
});

async function acceptIndexedPage(store: OperationStore, more = false, ids = [0, 1]) {
  await store.transition(scope, "old", 0, { status: "running", attemptKey: "source-attempt", executionStartedAt: at, dispatchedAt: at });
  await store.acceptPage(scope, "old", 1, { creatorId: "creator", fetchRunId: "old", leaseId: "old", fetchId: "page-0",
    requestId: "source-request", previews: ids.map(index => ({ platform: "youtube", contentId: String(index),
      canonicalUrl: `https://example.com/${index}`, text: "post", author: { id: "author", displayName: "Author" }, media: [] })),
    cursor: more ? "next" : null, hasMore: more, coverageComplete: !more, truncated: false, stopReason: more ? null : "done" }, at);
}
async function privateSourceCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("agentlens-obsidian-operations-v1");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("deliverySources", "readonly");
      const count = tx.objectStore("deliverySources").count();
      tx.oncomplete = () => { db.close(); resolve(count.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
it("archives each completed indexed work with its receipt and statistics before the scheduler resumes", async () => {
  const store = await fixture();
  await acceptIndexedPage(store);
  await store.beginPage(scope, "old", 1, 0, 0, "youtube:0");
  await store.commitWrite(scope, write(0), request("old"), true);
  // No subsequent settlePage is needed, even if the process stops here.
  const reopened = new OperationStore("statistics");
  expect((await reopened.pendingDeliveries(scope)).map(row => row.itemKey)).toEqual(["youtube:1"]);
  expect(await reopened.runStatistics(scope, "old")).toMatchObject({ savedCount: 1 });
  expect(await reopened.hasSavedReceipt(scope, "old", "youtube:0", "Research/0.md")).toBe(true);
  expect(await reopened.dueCallbacks(scope, Date.now())).toHaveLength(1);
  expect(await privateSourceCount()).toBe(1);
  await reopened.beginPage(scope, "old", 1, 0, 0, "youtube:1");
  await reopened.commitWrite(scope, write(1), request("old"), true);
  expect(await reopened.pendingDeliveries(scope)).toEqual([]);
  expect(await privateSourceCount()).toBe(0);
  expect(await reopened.runStatistics(scope, "old")).toMatchObject({ savedCount: 2 });
});

it("rolls back delivery archival and private source cleanup with all save evidence on archive failure", async () => {
  const store = await fixture();
  await acceptIndexedPage(store);
  await store.beginPage(scope, "old", 1, 0, 0, "youtube:0");
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, ...args) {
    if (this.name === "pages") throw new Error("archive disk failure");
    return put.apply(this, args);
  });
  await expect(store.commitWrite(scope, write(), request("old"), true)).rejects.toThrow("archive disk failure");
  failure.mockRestore();
  expect((await store.pendingDeliveries(scope)).map(row => row.itemKey).sort()).toEqual(["youtube:0", "youtube:1"]);
  expect(await privateSourceCount()).toBe(1);
  expect(await store.creatorStatistics(scope)).toBeUndefined();
  expect(await store.runStatistics(scope, "old")).toBeUndefined();
  expect(await store.writeReceipt(scope, "old", "youtube:0", "Research/0.md")).toBeUndefined();
  expect(await store.localLedger(scope, "youtube:0", "Research")).toBeUndefined();
  expect(await store.dueCallbacks(scope, Date.now())).toEqual([]);
  await store.commitWrite(scope, write(), request("old"), true);
  expect(await store.runStatistics(scope, "old")).toMatchObject({ savedCount: 1 });
});

it.each([true, false])("settles an empty final page only after all earlier works complete (writes first: %s)", async writesFirst => {
  const store = await fixture();
  await acceptIndexedPage(store, true);
  await store.commitWrite(scope, write(0), request("old"), true);
  if (writesFirst) await store.commitWrite(scope, write(1), request("old"), true);
  expect(await store.deliveryCompletion(scope, "old")).toBeUndefined();
  await store.transition(scope, "old", 2, { status: "running", attemptKey: "source-2", dispatchedAt: at });
  await store.acceptPage(scope, "old", 3, { creatorId: "creator", fetchRunId: "old", leaseId: "old", fetchId: "empty-final",
    requestId: "final-request", previews: [], cursor: null, hasMore: false, coverageComplete: true, truncated: false, stopReason: "done" }, at);
  await store.settlePage(scope, "old", 2, 0, "");
  if (!writesFirst) {
    expect(await store.deliveryCompletion(scope, "old")).toBeUndefined();
    expect(await store.callback(scope, "delivery-complete-old")).toBeUndefined();
    await store.commitWrite(scope, write(1), request("old"), true);
  }
  const reopened = new OperationStore("statistics");
  expect(await reopened.deliveryCompletion(scope, "old")).toMatchObject({ completedAt: expect.any(String) });
  expect(await reopened.callback(scope, "delivery-complete-old")).toMatchObject({ status: "pending", request: {
    fetchId: "page-0", fetchRunId: "old", writeAttemptId: "old:0:1", runComplete: true, coverageComplete: true, truncated: false,
    results: [{ contentKey: "youtube:1", status: "success" }] } });
  await reopened.commitWrite(scope, write(1), request("old"), true);
  await reopened.settlePage(scope, "old", 2, 0, "");
  expect(await reopened.dueCallbacks(scope, Date.now())).toHaveLength(3);
  expect(await reopened.runStatistics(scope, "old")).toMatchObject({ savedCount: 2 });
  expect(await privateSourceCount()).toBe(0);
});

it("does not fabricate a note callback for an entirely empty run", async () => {
  const store = await fixture();
  await acceptIndexedPage(store, false, []);
  await store.settlePage(scope, "old", 1, 0, "");
  expect(await store.deliveryCompletion(scope, "old")).toMatchObject({ completedAt: expect.any(String) });
  expect(await store.dueCallbacks(scope, Date.now())).toEqual([]);
});

it("rolls back final completion, final work, statistics and cleanup if the final outbox insert fails", async () => {
  const store = await fixture();
  await acceptIndexedPage(store);
  await store.commitWrite(scope, write(0), request("old"), true);
  const add = IDBObjectStore.prototype.add;
  const failure = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function(this: IDBObjectStore, ...args) {
    if (this.name === "callbacks" && args[0]?.idempotencyKey === "delivery-complete-old") throw new Error("final receipt disk failure");
    return add.apply(this, args);
  });
  await expect(store.commitWrite(scope, write(1), request("old"), true)).rejects.toThrow("final receipt disk failure");
  failure.mockRestore();
  expect((await store.pendingDeliveries(scope)).map(row => row.itemKey)).toEqual(["youtube:1"]);
  expect(await store.deliveryCompletion(scope, "old")).toBeUndefined();
  expect(await store.runStatistics(scope, "old")).toMatchObject({ savedCount: 1 });
  expect(await store.writeReceipt(scope, "old", "youtube:1", "Research/1.md")).toBeUndefined();
  expect(await store.dueCallbacks(scope, Date.now())).toHaveLength(1);
  expect(await privateSourceCount()).toBe(1);
  await store.commitWrite(scope, write(1), request("old"), true);
  expect(await store.deliveryCompletion(scope, "old")).toBeDefined();
  expect(await privateSourceCount()).toBe(0);
});

it("keeps unresolved publication bytes immutable and scoped to the original intent and attachment", async () => {
  const store = await fixture();
  const manifest = { ...write().manifest, attachments: [{ mediaId: "image", path: "Research/image.png", action: "new" as const, sourceUrl: "https://example.com/image" }] };
  const intent = await store.prepareWrite(scope, "old", manifest);
  const evidence = { mediaId: "image", path: "Research/image.png", sizeBytes: 42, sha256: "a".repeat(64) };
  const persist = (recoveryId: string, value = evidence) => store.prepareMediaPublication(scope, "old", manifest.contentKey, manifest.notePath, recoveryId, value);
  await persist(intent.recoveryId);
  await persist(intent.recoveryId);
  const reopened = new OperationStore("statistics");
  expect((await reopened.writeIntent(scope, "old", manifest.contentKey))?.mediaPublications).toEqual({ image: evidence });
  await expect(persist("different-intent")).rejects.toThrow("original write intent");
  await expect(persist(intent.recoveryId, { ...evidence, path: "Other/image.png" })).rejects.toThrow("original write intent");
  await expect(persist(intent.recoveryId, { ...evidence, sha256: "b".repeat(64) })).rejects.toThrow("cannot change");
  await expect(store.prepareMediaPublication({ ...scope, userId: "other" }, "old", manifest.contentKey, manifest.notePath, intent.recoveryId, evidence))
    .rejects.toThrow("original write intent");
  expect((await reopened.writeIntent(scope, "old", manifest.contentKey))?.mediaPublications).toEqual({ image: evidence });
});

it("atomically resumes only unattempted media after verified publication without consuming their first retry", async () => {
  const store = await fixture();
  await acceptIndexedPage(store);
  await store.beginPage(scope, "old", 1, 0, 0, "youtube:0");
  await store.failPage(scope, "old", 1, 1, false, true, "youtube:0", [{ mediaId: "first", kind: "write_unknown" }]);
  const recovered = { ...write(), reconciled: true, recovered: true,
    manifest: { ...write().manifest, attachments: ["first", "second"].map(mediaId => ({ mediaId, path: `Research/${mediaId}.png`, action: "new" as const, sourceUrl: "https://example.com/image" })) },
    ledger: { ...write().ledger, completion: "partial" as const }, attachments: [
      { mediaId: "first", path: "Research/first.png", status: "saved" as const },
      { mediaId: "second", path: "Research/second.png", status: "failed" as const, failureKind: "retryable" as const }
    ] };
  const add = IDBObjectStore.prototype.add;
  const failure = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function(this: IDBObjectStore, ...args) {
    if (this.name === "callbacks") throw new Error("recovery outbox unavailable");
    return add.apply(this, args);
  });
  await expect(store.commitWrite(scope, recovered, request("old"), true)).rejects.toThrow("recovery outbox unavailable");
  failure.mockRestore();
  expect(await store.runStatistics(scope, "old")).toBeUndefined();
  expect(await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toHaveLength(1);
  await store.commitWrite(scope, recovered, request("old"), true);
  expect(await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toEqual([]);
  expect(await store.runStatistics(scope, "old")).toMatchObject({ savedCount: 1 });
  await store.commitWrite(scope, recovered, request("old"), true);
  for (let attempt = 1; attempt <= 6; attempt++) {
    expect(await store.beginPage(scope, "old", 1, attempt, attempt * 300000, "youtube:0")).toBe(true);
    await store.failPage(scope, "old", 1, attempt + 1, false, false, "youtube:0", [{ mediaId: "second", kind: "retryable" }]);
  }
  await store.commitWrite(scope, recovered, request("old"), true);
  expect((await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "retry_exhausted"))[0]?.attempts).toBe(7);
});

it("commits mixed media evidence in the immutable original-task outbox", async () => {
  const store = await fixture();
  const partial = { ...write(), ledger: { ...write().ledger, completion: "partial" as const }, attachments: [
    { mediaId: "first", path: "Research/first.png", status: "saved" as const },
    { mediaId: "second", path: "Research/second.png", status: "failed" as const, failureKind: "source_expired" as const }
  ] };
  await store.commitWrite(scope, partial, request("old"), true);
  const reopened = new OperationStore("statistics");
  const callbacks = await reopened.dueCallbacks(scope, Date.now());
  expect(callbacks[0]?.request).toMatchObject({ fetchRunId: "old", writeAttemptId: "old:0:1", results: [{
    status: "partial", media: [{ mediaId: "first", status: "saved" }, { mediaId: "second", status: "failed" }] }] });
  await expect(reopened.commitWrite(scope, { ...partial, attachments: partial.attachments.map(item => ({ ...item, status: "failed" as const })) }, request("old"), true))
    .rejects.toThrow("cannot change");
  expect(await reopened.runStatistics(scope, "old")).toMatchObject({ savedCount: 1 });
});
