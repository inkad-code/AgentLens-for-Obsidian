import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationStore, type OperationScope, type SourceOperation } from "@/auto-fetch/operation-store";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });

const scope: OperationScope = { userId: "owner", installationId: "installation", creatorId: "creator" };
const at = "2026-09-16T10:00:00Z";
const checkpoint = { configRevision: 1, observedThrough: at };
function operation(id: string, admissionKey = id): SourceOperation {
  return {
    operationId: id, admissionKey, trigger: "normal", configRevision: 1,
    snapshot: { creatorId: scope.creatorId, platform: "instagram", profileUrl: "https://instagram.com/test/", displayName: "Test",
      saveFolderId: "folder", saveFolderPath: "/Folder", autoFetchEnabled: true,
      frequency: { every: 1, unit: "hour" }, timezone: "UTC", preferredTimes: [] },
    coverage: [{ revision: 1, firstSlot: 1, lastSlot: 1 }],
    scheduledAt: at, queuedAt: at, status: "queued", version: 0, attempts: 0
  };
}
describe("per-record durable source operations", () => {
  it("reopening the store retains tasks, original targets and the committed waterline", async () => {
    const first = new OperationStore("reopen");
    expect(await first.admit(scope, undefined, checkpoint, [operation("one")])).toBe(true);
    const reopened = new OperationStore("reopen");
    expect(await reopened.watermark(scope)).toEqual({ ...checkpoint, version: 0, lastSequence: 1 });
    expect(await reopened.get(scope, "one")).toEqual({ ...operation("one"), sequence: 1 });
  });
  it("two windows admitting the same waterline create exactly one operation", async () => {
    const first = new OperationStore("concurrent"), second = new OperationStore("concurrent");
    const results = await Promise.all([
      first.admit(scope, undefined, checkpoint, [operation("one")]),
      second.admit(scope, undefined, checkpoint, [operation("two")])
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect((await first.list(scope, "queued")).operations).toHaveLength(1);
  });
  it("a failed task insertion rolls back the watermark and every other insertion", async () => {
    const store = new OperationStore("atomic");
    await store.admit(scope, undefined, checkpoint, [operation("one", "slot-1")]);
    await expect(store.admit(scope, 0, { ...checkpoint, observedThrough: "2026-09-16T11:00:00Z" }, [
      operation("new-task", "slot-2"), operation("duplicate-task", "slot-1")
    ])).rejects.toBeTruthy();
    expect(await store.watermark(scope)).toEqual({ ...checkpoint, version: 0, lastSequence: 1 });
    expect(await store.get(scope, "new-task")).toBeUndefined();
    expect((await store.list(scope, "queued")).operations.map(item => item.operationId)).toEqual(["one"]);
  });
  it("isolates account, installation, creator and store namespace", async () => {
    const store = new OperationStore("scope");
    await store.admit(scope, undefined, checkpoint, [operation("one")]);
    for (const other of [{ ...scope, userId: "foreign" }, { ...scope, installationId: "other" }, { ...scope, creatorId: "other" }]) {
      expect(await store.get(other, "one")).toBeUndefined();
      expect(await store.watermark(other)).toBeUndefined();
      expect((await store.list(other, "queued")).operations).toEqual([]);
      expect(await store.transition(other, "one", 0, { status: "cancelled", cancellationReason: "configuration_changed" })).toBeUndefined();
    }
    expect(await new OperationStore("other").get(scope, "one")).toBeUndefined();
  });
  it("reads backlog in stable bounded pages without dropping the tail", async () => {
    const store = new OperationStore("paging");
    const jobs = Array.from({ length: 100 }, (_, n) => operation(`job-${String(n).padStart(3, "0")}`));
    await store.admit(scope, undefined, checkpoint, jobs);
    let page = await store.list(scope, "queued", 13);
    const ids: string[] = [];
    for (;;) {
      expect(page.operations.length).toBeLessThanOrEqual(13);
      ids.push(...page.operations.map(item => item.operationId));
      if (!page.next) break;
      page = await store.list(scope, "queued", 13, page.next);
    }
    expect(ids).toEqual(jobs.map(item => item.operationId));
  });
  it("fences duplicate dispatch and stale callbacks, then preserves unknown work across restart", async () => {
    const store = new OperationStore("dispatch");
    await store.admit(scope, undefined, checkpoint, [operation("one")]);
    const dispatch = { status: "running" as const, attemptKey: "attempt-one", executionStartedAt: at, dispatchedAt: at, attempts: 1 };
    const results = await Promise.all([store.transition(scope, "one", 0, dispatch), store.transition(scope, "one", 0, dispatch)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.transition(scope, "one", 0, { status: "source_succeeded" })).toBeUndefined();
    const unknown = await store.transition(scope, "one", 1, { status: "requires_reconciliation", errorCode: "NETWORK_TIMEOUT" });
    expect(unknown?.attemptKey).toBe("attempt-one");
    const reopened = new OperationStore("dispatch");
    expect((await reopened.list(scope, "queued")).operations).toEqual([]);
    await expect(reopened.transition(scope, "one", 2, { status: "queued" })).rejects.toThrow("Invalid execution transition");
    expect((await reopened.get(scope, "one"))?.attemptKey).toBe("attempt-one");
  });
  it("Configuration cancellation is durable and cannot cancel an already started operation", async () => {
    const store = new OperationStore("pause");
    await store.admit(scope, undefined, checkpoint, [operation("queued"), operation("started")]);
    await store.transition(scope, "queued", 0, { status: "cancelled", cancellationReason: "configuration_changed", completedAt: at });
    expect((await store.get(scope, "queued"))?.cancellationReason).toBe("configuration_changed");
    await store.transition(scope, "started", 0, { status: "running", attemptKey: "attempt", executionStartedAt: at, dispatchedAt: at });
    await expect(store.transition(scope, "started", 1, { status: "cancelled", cancellationReason: "configuration_changed" }))
      .rejects.toThrow("Invalid execution transition");
    expect((await store.get(scope, "started"))?.status).toBe("running");
  });
  it("rejects backwards watermarks and invalid batch sizes", async () => {
    const store = new OperationStore("validation");
    await store.admit(scope, undefined, checkpoint, [operation("one")]);
    await expect(store.admit(scope, 0, { ...checkpoint, observedThrough: "2026-09-15T10:00:00Z" }, []))
      .rejects.toThrow("cannot move backwards");
    await expect(store.admit(scope, 0, checkpoint, Array.from({ length: 101 }, (_, n) => operation(String(n)))))
      .rejects.toThrow("bounded batches");
    expect(await store.watermark(scope)).toEqual({ ...checkpoint, version: 0, lastSequence: 1 });
  });
  it("does not round microsecond watermarks backwards", async () => {
    const store = new OperationStore("micros");
    await store.admit(scope, undefined, { ...checkpoint, observedThrough: "2026-09-16T10:00:00.123456Z" }, []);
    await expect(store.admit(scope, 0, { ...checkpoint, observedThrough: "2026-09-16T10:00:00.123455Z" }, []))
      .rejects.toThrow("cannot move backwards");
  });
});

it("upgrades v1 records in place and indexes manual recovery separately", async()=>{
  const namespace="upgrade", scopeKey=JSON.stringify([namespace,scope.userId,scope.installationId,scope.creatorId]);
  const manual={...operation("manual-check-old"),trigger:"manual_check" as const,sequence:1};
  await new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open("agentlens-obsidian-operations-v1",1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      const watermarks=db.createObjectStore("watermarks",{keyPath:"scopeKey"});
      const tasks=db.createObjectStore("operations",{keyPath:"key"});
      tasks.createIndex("admission",["scopeKey","admissionKey"],{unique:true});
      tasks.createIndex("dispatch",["scopeKey","status","sequence"]);
      watermarks.put({...checkpoint,version:0,lastSequence:1,scopeKey});
      tasks.put({...manual,scopeKey,key:JSON.stringify([scopeKey,manual.operationId])});
    };
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{request.result.close();resolve();};
  });
  const upgraded=new OperationStore(namespace);
  expect((await upgraded.list(scope,"queued",8,undefined,"manual_check")).operations).toEqual([manual]);
  expect((await upgraded.list(scope,"queued",8,undefined,"normal")).operations).toEqual([]);
  expect((await upgraded.scopes(scope)).scopes).toEqual([scope]);
  expect(await upgraded.watermark(scope)).toEqual({...checkpoint,version:0,lastSequence:1});
});

it("keeps host acceptance storage in a separate database even when scope and namespace match", async () => {
  const production = new OperationStore("namespace");
  const isolated = new OperationStore("namespace", "isolated-acceptance-test");
  const listener = vi.fn();
  const unsubscribe = production.subscribe(listener);
  await isolated.admit(scope, undefined, checkpoint, [operation("fixture")]);
  expect(listener).not.toHaveBeenCalled();
  expect(await production.get(scope, "fixture")).toBeUndefined();
  expect(await production.watermark(scope)).toBeUndefined();
  await production.admit(scope, undefined, checkpoint, [operation("production")]);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  expect(await isolated.get(scope, "production")).toBeUndefined();
  expect((await new OperationStore("namespace", "isolated-acceptance-test").get(scope, "fixture"))?.operationId).toBe("fixture");
});
