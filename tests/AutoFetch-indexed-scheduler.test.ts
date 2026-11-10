import type { BatchSaveResult } from "@/workbench/types";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedScheduler } from "@/auto-fetch/indexed-scheduler";
import { OperationStore } from "@/auto-fetch/operation-store";
import { RequestCoordinator } from "@/runtime/RequestCoordinator";
import type { AgentLensApiPort } from "@/workbench/ports";
import type { CreatorRecord, CreatorUpdatePage, SchedulerLease } from "@/api/AgentLensApiClient";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
const start = "2026-10-19T00:00:00.000Z";
const scope = { userId: "user", installationId: "vault", creatorId: "creator" };
const creator: CreatorRecord = { creatorId: "creator", platform: "youtube", profileUrl: "https://youtube.com/@creator",
  displayName: "Creator", followId: "follow", configRevision: 1, scheduleAnchorAt: start, activationAt: start,
  saveFolderPath: "Research", noteTemplateId: "default", mediaPolicy: "link_only", autoFetchEnabled: true,
  frequency: { every: 1, unit: "hour" }, timezone: "UTC", preferredTimes: [],
  handle: null, avatarUrl: null, nextCheckAt: null, lastCheckedAt: null, lastUpdateAt: null,
  lastResult: null, lastError: null, importedCount: 0, schedulerState: "scheduled", retryAt: null,
  activeJobId: null, activeJobTrigger: null };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let now = new Date(start), sequence = 0;
  let currentCreator: CreatorRecord | undefined = creator;
  const store = new OperationStore("driver");
  const session = { ...scope, accessToken: "token", epoch: 1, sequenceFloor: 75 };
  const listCreators = vi.fn(async () => currentCreator ? [currentCreator] : []);
  const scheduleHistory = vi.fn(async () => ({ followId: "follow", throughRevision: 1, nextAfterRevision: null,
    revisions: [{ revision: 1, effectiveAt: start, anchorAt: start, frequencyEvery: 1,
      frequencyUnit: "hour", autoFetchEnabled: true, deleted: false, legacySnapshot: false }] }));
  const creatorUpdates = vi.fn(async (_token: string, lease: SchedulerLease): Promise<CreatorUpdatePage> => ({ creatorId: "creator",
    fetchRunId: lease.leaseId, leaseId: lease.leaseId, fetchId: `fetch-${lease.leaseId}`, requestId: "request",
    previews: [], hasMore: false, cursor: null, coverageComplete: true, truncated: false, stopReason: "done" }));
  const reconcile = vi.fn();
  const api = { listCreators, scheduleHistory, creatorUpdates, reconcile } as unknown as AgentLensApiPort;
  const deliver = vi.fn(async (_token: string, _page: CreatorUpdatePage, _lease: SchedulerLease, _sequence: number, _attempt: number, _confirmOnly?: boolean | "reuse"): Promise<BatchSaveResult> => ({ successes: [], failures: [] }));
  const dependencies = { store, api, requests: new RequestCoordinator(), session: async () => session, deliver,
    source: <T>(_id: string, task: () => Promise<T>) => task(), now: () => now, createId: () => `id-${++sequence}` };
  const scheduler = new IndexedScheduler(dependencies);
  return { store, scheduler, dependencies, creatorUpdates, scheduleHistory, deliver, reconcile,
    time(hour: number) { now = new Date(Date.parse(start) + hour * 3600_000); },
    creator(value: CreatorRecord | undefined) { currentCreator = value; } };
}

describe("production indexed scheduling orchestration", () => {
  it("admits a later slot while the earlier delivery is blocked, without legacy reconcile", async () => {
    const f = fixture();
    await f.scheduler.run("service_start");
    const gate = deferred();
    f.deliver.mockImplementation(async () => { await gate.promise; return { successes: [], failures: [] }; });
    f.time(1);
    const first = f.scheduler.run("periodic_tick");
    await vi.waitFor(() => expect(f.deliver).toHaveBeenCalledTimes(1));
    f.time(2);
    const second = f.scheduler.run("periodic_tick");
    await vi.waitFor(() => expect(f.creatorUpdates).toHaveBeenCalledTimes(2));
    expect((await f.store.watermark(scope))?.observedThrough).toBe("2026-10-19T02:00:00.000Z");
    const records = await f.store.list(scope, "source_succeeded");
    expect(records.operations.map(item => item.sequence)).toEqual([76, 77]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(await f.store.pendingPages(scope)).toEqual([]);
    expect(f.reconcile).not.toHaveBeenCalled();
  });

  it("restart preserves the boundary and merges offline slots into one recovery task", async () => {
    const f = fixture();
    await f.scheduler.run("service_start");
    f.time(5);
    const restarted = new IndexedScheduler(f.dependencies);
    await restarted.run("service_start");
    await restarted.run("network_restored");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(f.creatorUpdates.mock.calls[0]![1]).toMatchObject({ trigger: "catch_up",
      plan: { recoveryFrom: start, recoveryThrough: "2026-10-19T05:00:00.000Z" } });
  });

  it("manual checks run during paused scheduling without advancing its watermark", async () => {
    const f = fixture();
    await f.scheduler.run("service_start");
    f.creator({ ...creator, autoFetchEnabled: false });
    f.time(2);
    await f.scheduler.manual(creator);
    expect(f.creatorUpdates.mock.calls[0]![1].trigger).toBe("manual_check");
    expect((await f.store.watermark(scope))?.observedThrough).toBe(start);
  });

  it("retains a page when delivery fails and recovers it without fetching again", async () => {
    const f = fixture();
    await f.scheduler.run("service_start");
    f.time(1);
    f.deliver.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(f.scheduler.run("periodic_tick")).rejects.toThrow("disk unavailable");
    expect(await f.store.pendingPages(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toHaveLength(1);
    await f.scheduler.run("periodic_tick");
    expect(f.deliver).toHaveBeenCalledTimes(1);
    f.time(1.1);
    await f.scheduler.run("periodic_tick");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(await f.store.pendingPages(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toHaveLength(0);
    expect(f.deliver.mock.calls[1]?.[5]).toBe(true);
  });

  it("recovers saved deliveries after their binding has been deleted", async () => {
    const f = fixture();
    await f.scheduler.run("service_start");
    f.time(1);
    f.deliver.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(f.scheduler.run("periodic_tick")).rejects.toThrow("disk unavailable");
    f.creator(undefined);
    f.time(1.1);
    await new IndexedScheduler(f.dependencies).run("service_start");
    expect(await f.store.pendingPages(scope)).toHaveLength(0);
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
  });

  it("persists six attempts and a five-minute delay across restarts", async () => {
    const f = fixture();
    await f.scheduler.run("service_start");
    const post = { platform: "youtube", contentId: "post", canonicalUrl: "https://example.com/post", text: "Post",
      author: { id: "author", displayName: "Author" }, media: [] };
    const source = f.creatorUpdates.getMockImplementation()!;
    f.creatorUpdates.mockImplementation(async (token, lease) => ({ ...await source(token, lease), previews: [post] }));
    f.deliver.mockResolvedValue({ successes: [], failures: [{ preview: { post, demo: false }, error: "temporary write failure" }] });
    for (let attempt = 0; attempt < 6; attempt++) {
      f.time(1 + attempt / 10);
      await expect(new IndexedScheduler(f.dependencies).run("periodic_tick")).resolves.toMatchObject({ failed: 1 });
    }
    f.time(1.7);
    await new IndexedScheduler(f.dependencies).run("periodic_tick");
    expect(f.deliver.mock.calls.filter(call => !call[5])).toHaveLength(6);
    expect(f.deliver.mock.calls.filter(call => call[5] === "reuse")).toHaveLength(1);
    expect((await f.store.pendingPages(scope, 8, Date.now(), "retry_exhausted"))[0]?.attempts).toBe(6);
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
  });

  it("a new follow is registered at activation before its first delayed tick", async () => {
    const f = fixture();
    await f.scheduler.register(creator, start);
    f.time(3);
    await f.scheduler.run("service_start");
    expect(f.creatorUpdates.mock.calls[0]![1]).toMatchObject({ trigger: "catch_up", plan: { recoveryFrom: start } });
  });

  it("rejects incomplete schedule history without advancing its waterline", async () => {
    const f = fixture();
    await f.scheduler.run("service_start");
    f.time(2);
    f.scheduleHistory.mockResolvedValue({ followId: "other", throughRevision: 1, nextAfterRevision: null, revisions: [] });
    expect(await f.scheduler.run("periodic_tick")).toMatchObject({ failed: 1 });
    expect((await f.store.watermark(scope))?.observedThrough).toBe(start);
    expect(f.creatorUpdates).not.toHaveBeenCalled();
  });
});


it.each(["write_unknown", "needs_refetch", "retry_exhausted"] as const)("rotates bounded %s verification past records that still lack proof", async status => {
  const f = fixture();
  await f.scheduler.run("service_start");
  f.creator({ ...creator, autoFetchEnabled: false });
  const watermark = (await f.store.watermark(scope))!;
  const operations = Array.from({ length: 9 }, (_, index) => ({ operationId: `unknown-${index}`, admissionKey: `unknown-${index}`,
    trigger: "normal" as const, configRevision: 1, snapshot: creator, coverage: [], queuedAt: start,
    status: "queued" as const, attempts: 0, version: 0 }));
  await f.store.admit(scope, watermark.version, watermark, operations);
  for (const operation of operations) {
    await f.store.transition(scope, operation.operationId, 0, { status: "running", attemptKey: "source", attempts: 1,
      executionStartedAt: start, dispatchedAt: start });
    await f.store.acceptPage(scope, operation.operationId, 1, { creatorId: "creator", fetchRunId: operation.operationId,
      leaseId: operation.operationId, fetchId: "page", requestId: "request", previews: [], hasMore: false, cursor: null,
      coverageComplete: true, truncated: false, stopReason: "done" }, start);
    for (let attempt = 0; attempt < (status === "retry_exhausted" ? 6 : 1); attempt++) {
      await f.store.beginPage(scope, operation.operationId, 1, attempt, Date.parse(start) + attempt * 300_000);
      await f.store.failPage(scope, operation.operationId, 1, attempt + 1, status === "needs_refetch", status === "write_unknown");
    }
  }
  f.deliver.mockImplementation(async (_token, page, _lease, _sequence, attempt, confirmOnly) => {
    expect(confirmOnly).toBe(status === "write_unknown" ? true : "reuse"); expect(attempt).toBe(status === "retry_exhausted" ? 6 : 1);
    if (page.fetchRunId !== "unknown-8") throw new Error("Physical proof is not available");
    return { successes: [], failures: [] };
  });
  f.time(1);
  expect(await f.scheduler.run("periodic_tick")).toMatchObject({ deferred: 8 });
  await f.scheduler.run("periodic_tick");
  expect(f.deliver).toHaveBeenCalledTimes(9);
  expect(await f.store.pendingPages(scope, 100, Date.now(), status)).toHaveLength(8);
  expect(f.creatorUpdates).not.toHaveBeenCalled();
});

it("runs a later normal task after restart while an older write remains unprovable under its original identity", async () => {
  const f = fixture();
  await f.scheduler.run("service_start");
  f.time(1);
  f.deliver.mockRejectedValueOnce(new Error("publication acknowledgement lost"));
  await expect(f.scheduler.run("periodic_tick")).rejects.toThrow("publication acknowledgement lost");
  const [original] = await f.store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown");
  expect(original).toBeDefined();

  f.deliver.mockImplementation(async (_token, page) => {
    if (page.fetchRunId === original!.page.fetchRunId) {
      throw new Error("Physical proof is still unavailable");
    }
    return { successes: [], failures: [] };
  });
  f.time(1.1);
  const restarted = new IndexedScheduler({ ...f.dependencies, store: new OperationStore("driver") });
  await restarted.run("service_start");
  f.time(2);
  await restarted.run("periodic_tick");
  expect(f.creatorUpdates).toHaveBeenCalledTimes(2);
  expect(f.creatorUpdates.mock.calls[1]![1]).toMatchObject({ trigger: "normal" });
  const unresolved = await f.store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown");
  expect(unresolved).toHaveLength(1);
  expect(unresolved[0]).toMatchObject({ operationId: original!.operationId, attempts: 1,
    page: { requestId: original!.page.requestId, fetchId: original!.page.fetchId } });
  expect(await f.store.pendingDeliveries(scope)).toEqual([]);
  const newId = f.creatorUpdates.mock.calls[1]![1].leaseId;
  expect((await f.store.taskHistory(scope, "Research")).items.find(item => item.operationId === newId)?.deliveryCompletedAt).toBeTruthy();
  expect(f.deliver.mock.calls.filter(call => call[1].fetchRunId === original!.page.fetchRunId && !call[5])).toHaveLength(1);
  const confirmations = f.deliver.mock.calls.slice(1).filter(call => call[1].fetchRunId === original!.page.fetchRunId);
  expect(confirmations.length).toBeGreaterThan(0);
  for (const call of confirmations) {
    expect(call[1].requestId).toBe(original!.page.requestId);
    expect(call[2].leaseId).toBe(original!.operationId);
    expect(call[3]).toBe(original!.sequence);
    expect(call[4]).toBe(original!.attempts);
    expect(call[5]).toBe(true);
  }
  expect(f.deliver.mock.calls.find(call => call[1].fetchRunId === newId)?.[5]).toBeUndefined();
});

it("keeps long delivery exclusive across windows after the five-minute retry boundary", async () => {
  const f = fixture(); await f.scheduler.run("service_start"); f.time(1);
  const gate = deferred();
  f.deliver.mockImplementation(async () => { await gate.promise; return { successes: [], failures: [] }; });
  const first = f.scheduler.run("periodic_tick");
  await vi.waitFor(() => expect(f.deliver).toHaveBeenCalledTimes(1));
  f.time(1.5);
  const other = new IndexedScheduler({ ...f.dependencies, requests: new RequestCoordinator() });
  const second = other.run("periodic_tick");
  await vi.waitFor(() => expect(f.scheduleHistory.mock.calls.length).toBeGreaterThanOrEqual(3));
  expect(f.deliver).toHaveBeenCalledTimes(1);
  gate.resolve(); await first; await second;
  expect(f.deliver).toHaveBeenCalledTimes(1);
  expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
});

it("rejects another window's duplicate manual check without admitting a second operation", async () => {
  const f = fixture(); await f.scheduler.run("service_start");
  const gate = deferred();
  const original = f.creatorUpdates.getMockImplementation()!;
  f.creatorUpdates.mockImplementation(async (...args) => { await gate.promise; return original(...args); });
  const first = f.scheduler.manual(creator);
  await vi.waitFor(() => expect(f.creatorUpdates).toHaveBeenCalledTimes(1));
  const other = new IndexedScheduler({ ...f.dependencies, requests: new RequestCoordinator() });
  await expect(other.manual(creator)).rejects.toThrow("another window");
  gate.resolve(); await first;
  expect((await f.store.list(scope, "source_succeeded", 100, undefined, "manual_check")).operations).toHaveLength(1);
});

it("lets manual source dispatch bypass all four host-owned automatic slots", async () => {
  const { hostExecutionLocks } = await import("@/runtime/HostExecutionLocks");
  const f = fixture(); await f.scheduler.run("service_start");
  const gate = deferred(); let entered = 0;
  const holders = Array.from({ length: 4 }, (_, index) => hostExecutionLocks.run(
    ["source-lane", scope.installationId, String(index)], async () => { entered++; await gate.promise; }));
  await vi.waitFor(() => expect(entered).toBe(4));
  f.time(1); const automatic = f.scheduler.run("periodic_tick");
  try {
    await vi.waitFor(async () => expect((await f.store.list(scope, "queued")).operations).toHaveLength(1));
    const other = new IndexedScheduler({ ...f.dependencies, requests: new RequestCoordinator() });
    await other.manual(creator);
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(f.creatorUpdates.mock.calls[0]?.[1].trigger).toBe("manual_check");
  } finally { gate.resolve(); await Promise.all(holders); await automatic; }
  expect((await f.store.list(scope, "queued")).operations).toHaveLength(1);
  await f.scheduler.run("periodic_tick");
  expect(f.creatorUpdates).toHaveBeenCalledTimes(2);
});

it("coalesces a hundred ticks during a slow delivery without a hundred storage scans", async () => {
  const f = fixture(); await f.scheduler.run("service_start"); f.time(1);
  const gate = deferred(), reads = vi.spyOn(f.store, "pendingDeliveries");
  f.deliver.mockImplementation(async () => { await gate.promise; return { successes: [], failures: [] }; });
  const first = f.scheduler.run("periodic_tick");
  await vi.waitFor(() => expect(f.deliver).toHaveBeenCalledTimes(1));
  const scansBeforeTicks = reads.mock.calls.length;
  try {
    for (let tick = 0; tick < 100; tick++) expect(await f.scheduler.run("periodic_tick")).toMatchObject({ deferred: 1 });
    expect(reads).toHaveBeenCalledTimes(scansBeforeTicks);
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
  } finally { gate.resolve(); await first; }
  expect(reads.mock.calls.length - scansBeforeTicks).toBeLessThanOrEqual(7);
  expect(f.deliver).toHaveBeenCalledTimes(1);
  expect(await f.store.pendingPages(scope)).toEqual([]);
});

it("keeps source backlog durable while four slow calls occupy all automatic slots", async () => {
  const f = fixture(); await f.scheduler.run("service_start");
  const watermark = (await f.store.watermark(scope))!;
  await f.store.admit(scope, watermark.version, watermark, Array.from({ length: 12 }, (_, index) => ({
    operationId: `slow-${index}`, admissionKey: `slow-${index}`, trigger: "normal" as const, configRevision: 1,
    snapshot: creator, coverage: [], queuedAt: start, status: "queued" as const, attempts: 0, version: 0 })));
  const gate = deferred(), original = f.creatorUpdates.getMockImplementation()!;
  f.creatorUpdates.mockImplementation(async (...args) => { await gate.promise; return original(...args); });
  const first = f.scheduler.run("periodic_tick");
  await vi.waitFor(() => expect(f.creatorUpdates).toHaveBeenCalledTimes(4));
  try {
    for (let tick = 0; tick < 100; tick++) await f.scheduler.run("periodic_tick");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(4);
    expect((await f.store.list(scope, "queued", 100)).operations).toHaveLength(8);
  } finally { gate.resolve(); await first; }
  for (let pass = 0; pass < 5; pass++) await f.scheduler.run("periodic_tick");
  expect((await f.store.list(scope, "source_succeeded", 100)).operations).toHaveLength(12);
  expect(f.creatorUpdates).toHaveBeenCalledTimes(12);
});

it("coalesces slow configuration synchronization and keeps newer recovery events", async () => {
  const f = fixture(); await f.scheduler.run("service_start"); f.time(1);
  const gate = deferred(), original = f.scheduleHistory.getMockImplementation()!;
  f.scheduleHistory.mockImplementationOnce(async () => { await gate.promise; return original(); });
  const first = f.scheduler.run("periodic_tick");
  await vi.waitFor(() => expect(f.scheduleHistory).toHaveBeenCalledTimes(2));
  f.time(2);
  try {
    for (let tick = 0; tick < 100; tick++) expect(await f.scheduler.run("host_activated")).toMatchObject({ deferred: 1 });
    expect(f.scheduleHistory).toHaveBeenCalledTimes(2);
  } finally { gate.resolve(); await first; }
  expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
  expect(f.creatorUpdates.mock.calls[0]?.[1].trigger).toBe("catch_up");
  await f.scheduler.run("periodic_tick");
  expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
  expect((await f.store.watermark(scope))?.observedThrough).toBe("2026-10-19T02:00:00.000Z");
});

it("retries one work while expired and unknown siblings retain their original evidence", async () => {
  const f = fixture();
  await f.scheduler.run("service_start");
  const posts = ["expired", "temporary", "unknown", "saved"].map(contentId => ({ platform: "youtube", contentId,
    canonicalUrl: `https://example.com/${contentId}`, text: contentId, author: { id: "author", displayName: "Author" }, media: [] }));
  f.creatorUpdates.mockImplementation(async (_token, lease) => ({ creatorId: "creator", fetchRunId: lease.leaseId, leaseId: lease.leaseId,
    fetchId: "mixed", requestId: "mixed-request", previews: posts, hasMore: false, cursor: null, coverageComplete: true, truncated: false, stopReason: "done" }));
  f.deliver.mockImplementation(async (_token, page, _lease, _sequence, attempt) => {
    expect(page.previews).toHaveLength(1);
    const post = page.previews[0]!;
    if (post.contentId === "saved" || post.contentId === "temporary" && attempt === 2) return { successes: [], failures: [] };
    return { successes: [], failures: [{ preview: { post, demo: false },
      error: post.contentId === "expired" ? "HTTP 403 expired" : "temporary failure",
      ...(post.contentId === "unknown" ? { code: "WRITE_REQUIRES_RECONCILIATION" } : {}) }] };
  });
  f.time(1);
  await f.scheduler.run("periodic_tick");
  expect(f.deliver.mock.calls.filter(call => !call[5])).toHaveLength(4);
  f.time(1.1);
  await new IndexedScheduler(f.dependencies).run("periodic_tick");
  const writes = f.deliver.mock.calls.filter(call => !call[5]);
  expect(writes).toHaveLength(5);
  expect(writes[4]![1].previews[0]?.contentId).toBe("temporary");
  expect(writes[4]![4]).toBe(2);
  expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
  expect(await f.store.pendingDeliveries(scope)).toEqual([]);
  expect((await f.store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "needs_refetch"))[0]?.itemKey).toBe("youtube:expired");
  expect((await f.store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown"))[0]?.itemKey).toBe("youtube:unknown");
});

it("reports live source work under the dispatched task's account, session and frozen destination", async () => {
  const f = fixture();
  await f.scheduler.run("service_start");
  const observed = vi.fn();
  const source = async <T>(id: string, task: () => Promise<T>, activityScope: unknown): Promise<T> => {
    observed(id, task, activityScope); return task();
  };
  const scheduler = new IndexedScheduler({ ...f.dependencies, source });
  f.time(1);
  await scheduler.run("periodic_tick");
  expect(observed).toHaveBeenCalledWith("creator", expect.any(Function), {
    ...scope, epoch: 1, folderPath: "Research"
  });
});

it.each(["retryable", "source_expired"] as const)("uses structured %s media evidence instead of guessing from display text", async kind => {
  const f = fixture();
  await f.scheduler.run("service_start");
  const post = { platform: "youtube", contentId: "post", canonicalUrl: "https://example.com/post", text: "post",
    author: { id: "author", displayName: "Author" }, media: [] };
  f.creatorUpdates.mockImplementation(async (_token, lease) => ({ creatorId: "creator", fetchRunId: lease.leaseId, leaseId: lease.leaseId,
    fetchId: "page", requestId: "request", previews: [post], hasMore: false, cursor: null, coverageComplete: true, truncated: false, stopReason: "done" }));
  f.deliver.mockResolvedValue({ successes: [], failures: [{ preview: { post, demo: false },
    error: kind === "retryable" ? "expired local handle HTTP 403" : "display text without status",
    mediaFailures: [{ mediaId: "image", kind }] }] });
  f.time(1);
  await f.scheduler.run("periodic_tick");
  const records = await f.store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, kind === "retryable" ? "pending" : "needs_refetch");
  expect(records).toHaveLength(1);
  expect(records[0]?.mediaFailures).toEqual([{ mediaId: "image", kind }]);
});
