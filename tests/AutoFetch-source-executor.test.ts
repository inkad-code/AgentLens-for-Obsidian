import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationStore, type SourceOperation } from "@/auto-fetch/operation-store";
import { SourceExecutor } from "@/auto-fetch/source-executor";
import type { CreatorRecord, CreatorUpdatePage } from "@/api/AgentLensApiClient";
import type { ExecutionOperation } from "@/api/executions";
import { AgentLensError } from "@/core/errors";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
const scope = { userId: "user", installationId: "vault", creatorId: "creator" };
const now = "2026-10-19T01:00:00Z";
const creator = { creatorId: "creator", platform: "youtube", profileUrl: "https://youtube.com/@creator",
  displayName: "Creator", followId: "follow", configRevision: 1, scheduleAnchorAt: "2026-10-19T00:00:00Z",
  saveFolderPath: "Research", noteTemplateId: "default", mediaPolicy: "link_only", autoFetchEnabled: true,
  frequency: { every: 1, unit: "hour" }, timezone: "UTC", preferredTimes: [],
  handle: null, avatarUrl: null, nextCheckAt: null, lastCheckedAt: null, lastUpdateAt: null,
  lastResult: null, lastError: null, importedCount: 0, schedulerState: "scheduled", retryAt: null,
  activeJobId: null, activeJobTrigger: null } satisfies CreatorRecord;
function operation(id = "run"): SourceOperation {
  return { operationId: id, admissionKey: id, trigger: "normal", configRevision: 1, snapshot: creator,
    plan: { configRevision: 1, slotIndex: 1 }, coverage: [{ revision: 1, firstSlot: 1, lastSlot: 1 }],
    queuedAt: now, status: "queued", version: 0, attempts: 0 };
}
function page(id = "run", more = false): CreatorUpdatePage {
  return { creatorId: "creator", fetchRunId: id, leaseId: id, fetchId: "fetch", requestId: "request", previews: [],
    hasMore: more, cursor: more ? "next" : null, coverageComplete: !more, truncated: false, stopReason: more ? null : "done" };
}
async function fixture() {
  const store = new OperationStore("executor");
  await store.admit(scope, undefined, { observedThrough: now, configRevision: 1 }, [operation()]);
  let context = { userId: scope.userId, installationId: scope.installationId, accessToken: "token", online: true,
    creator: creator as CreatorRecord | undefined };
  let sequence = 0;
  const api = { creatorUpdates: vi.fn(async () => page()),
    getExecution: vi.fn(async (): Promise<ExecutionOperation> => ({ operationId: "run", creatorId: "creator", runTrigger: "normal",
      sourceStatus: "source_succeeded", retryAt: null, latestPageNumber: 1, nextPageCursor: null, activePageCursor: null,
      target: { installationId: "vault", bindingId: "creator", targetId: null, folderId: null, folderPath: "Research" }, jobs: [] })),
    inspectExecutionRecovery: vi.fn(async () => ({ operationId: "run", creatorId: "creator", configRevision: 1, disposition: "not_started" as const })),
    resumeUnstartedExecution: vi.fn(async () => ({ operationId: "run", creatorId: "creator", configRevision: 1, disposition: "not_started" as const })) };
  const executor = () => new SourceExecutor({ store, api, context: async () => context,
    createId: () => `request-${++sequence}`, now: () => new Date(now) });
  return { store, api, executor, setContext(patch: Partial<typeof context>) { context = { ...context, ...patch }; } };
}

describe("durable source execution against the shared API", () => {
  it("commits a page and advances its source before any delivery is processed", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockResolvedValueOnce(page("run", true)).mockResolvedValueOnce({ ...page(), fetchId: "page-2" });
    expect(await f.executor().run(scope, "run")).toBe("page_saved");
    expect(await f.store.get(scope, "run")).toMatchObject({ status: "waiting_continuation", pageNumber: 2, cursor: "next" });
    expect(await f.executor().run(scope, "run")).toBe("page_saved");
    expect(await f.store.get(scope, "run")).toMatchObject({ status: "source_succeeded" });
    expect(await f.store.pendingPages(scope)).toHaveLength(2);
    expect(f.api.creatorUpdates.mock.calls[1]).toEqual(["token", expect.objectContaining({ trigger: "continuation", plan: { configRevision: 1, slotIndex: 1 } }), "next", "request-2", "auto-run-2"]);
  });
  it("a lost response is reconciled and replayed with exactly its original identity after restart", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    expect(await f.executor().run(scope, "run")).toBe("failed");
    expect(await f.store.get(scope, "run")).toMatchObject({ status: "requires_reconciliation" });
    expect(await f.executor().run(scope, "run")).toBe("page_saved");
    expect(f.api.getExecution).toHaveBeenCalledWith("token", "run");
    expect(f.api.creatorUpdates.mock.calls[1]).toEqual(f.api.creatorUpdates.mock.calls[0]);
  });
  it("running evidence cannot authorize a duplicate source request", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    await f.executor().run(scope, "run");
    f.api.getExecution.mockResolvedValue({ ...await f.api.getExecution(), sourceStatus: "running", latestPageNumber: 0 });
    expect(await f.executor().run(scope, "run")).toBe("deferred");
    expect(f.api.creatorUpdates).toHaveBeenCalledTimes(1);
  });
  it("only confirmed missing/unstarted evidence allows replay", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    await f.executor().run(scope, "run");
    f.api.getExecution.mockRejectedValue(new AgentLensError("unknown", "missing", false, 404));
    f.api.resumeUnstartedExecution.mockResolvedValueOnce({ operationId: "run", creatorId: "creator", configRevision: 2, disposition: "not_started" });
    expect(await f.executor().run(scope, "run")).toBe("deferred");
    expect(f.api.resumeUnstartedExecution).toHaveBeenCalledWith("token", "creator", "run", 1);
    expect(await f.executor().run(scope, "run")).toBe("page_saved");
    expect(f.api.creatorUpdates.mock.calls[1]).toEqual(f.api.creatorUpdates.mock.calls[0]);
  });
  it("pause preserves queued work but a changed destination cancels an unstarted task", async () => {
    const f = await fixture();
    f.setContext({ creator: { ...creator, autoFetchEnabled: false, configRevision: 2 } });
    expect(await f.executor().run(scope, "run")).toBe("page_saved");
    const waterline = (await f.store.watermark(scope))!;
    await f.store.admit(scope, waterline.version, waterline, [operation("next")]);
    f.setContext({ creator: { ...creator, saveFolderPath: "Other" } });
    expect(await f.executor().run(scope, "next")).toBe("cancelled");
    expect(f.api.creatorUpdates).toHaveBeenCalledTimes(1);
  });
  it("offline or a foreign account cannot claim a queued operation", async () => {
    const f = await fixture();
    f.setContext({ online: false });
    expect(await f.executor().run(scope, "run")).toBe("deferred");
    f.setContext({ online: true, userId: "other" });
    expect(await f.executor().run(scope, "run")).toBe("deferred");
    expect(await f.store.get(scope, "run")).toMatchObject({ status: "queued", attempts: 0 });
    expect(f.api.creatorUpdates).not.toHaveBeenCalled();
  });
  it("a foreign destination in recovery evidence is retained without replay", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    await f.executor().run(scope, "run");
    const remote = await f.api.getExecution();
    f.api.getExecution.mockResolvedValue({ ...remote, target: { ...remote.target, folderPath: "Other" } });
    await expect(f.executor().run(scope, "run")).rejects.toThrow("target changed");
    expect(f.api.creatorUpdates).toHaveBeenCalledTimes(1);
  });
  it("quota rejection terminates this task without destroying the next independent task", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockRejectedValueOnce(new AgentLensError("quota_exhausted", "quota", false, 402));
    await f.executor().run(scope, "run");
    expect(await f.store.get(scope, "run")).toMatchObject({ status: "failed" });
    const watermark = (await f.store.watermark(scope))!;
    await f.store.admit(scope, watermark.version, watermark, [operation("next")]);
    f.api.creatorUpdates.mockResolvedValue(page("next"));
    expect(await f.executor().run(scope, "next")).toBe("page_saved");
  });
  it("retains incomplete coverage and its deliverable page without claiming full success", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockResolvedValue({ ...page(), coverageComplete: false, truncated: true });
    await f.executor().run(scope, "run");
    expect(await f.store.get(scope, "run")).toMatchObject({ status: "failed", errorCode: "AUTO_FETCH_COVERAGE_INCOMPLETE" });
    expect(await f.store.pendingPages(scope)).toHaveLength(1);
  });
  it("requires a due retry and positive finite retry budget with no active provider job", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockRejectedValueOnce(new Error("lost"));
    await f.executor().run(scope, "run");
    const remote = { ...await f.api.getExecution(), sourceStatus: "retry_pending", latestPageNumber: 0, retryAt: now };
    f.api.getExecution.mockResolvedValue({ ...remote, jobs: [{ status: "processing", retryable: true, retryCount: 0, maxRetries: 2 }] });
    expect(await f.executor().run(scope, "run")).toBe("deferred");
    f.api.getExecution.mockResolvedValue({ ...remote, jobs: [{ status: "retry_pending", retryable: true, retryCount: 2, maxRetries: 2 }] });
    expect(await f.executor().run(scope, "run")).toBe("deferred");
    f.api.getExecution.mockResolvedValue({ ...remote, jobs: [{ status: "retry_pending", retryable: true, retryCount: 1, maxRetries: 2 }] });
    expect(await f.executor().run(scope, "run")).toBe("page_saved");
    expect(f.api.creatorUpdates).toHaveBeenCalledTimes(2);
  });
  it("two renderers racing to dispatch claim only one persisted operation", async () => {
    const f = await fixture();
    await Promise.all([f.executor().run(scope, "run"), f.executor().run(scope, "run")]);
    expect(f.api.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(await f.store.pendingPages(scope)).toHaveLength(1);
  });
  it("account change while the response is in flight retains reconciliation evidence without delivery", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockImplementation(async () => { f.setContext({ userId: "foreign" }); return page(); });
    await f.executor().run(scope, "run");
    expect(await f.store.get(scope, "run")).toMatchObject({ status: "requires_reconciliation" });
    expect(await f.store.pendingPages(scope)).toEqual([]);
  });
  it("a failed page insertion rolls back source progress and preserves earlier page evidence", async () => {
    const f = await fixture();
    f.api.creatorUpdates.mockResolvedValue(page("run", true));
    await f.executor().run(scope, "run");
    const saved = (await f.store.get(scope, "run"))!;
    const claimed = (await f.store.transition(scope, "run", saved.version, { status: "running", pageNumber: 1,
      requestId: "duplicate", attemptKey: "duplicate", dispatchedAt: now, executionStartedAt: now }))!;
    await expect(f.store.acceptPage(scope, "run", claimed.version, page(), now)).rejects.toBeTruthy();
    expect(await f.store.get(scope, "run")).toEqual(claimed);
    expect(await f.store.pendingPages(scope)).toHaveLength(1);
  });

  it("rechecks configuration after the durable claim and never sends an unsent stale target", async () => {
    const f = await fixture();
    let reads = 0;
    const executor = new SourceExecutor({ store: f.store, api: f.api, now: () => new Date(now), createId: () => "request",
      context: async () => ({ userId: "user", installationId: "vault", accessToken: "token", online: true,
        creator: ++reads >= 3 ? { ...creator, saveFolderPath: "Changed" } : creator }) });
    expect(await executor.run(scope, "run")).toBe("cancelled");
    expect(f.api.creatorUpdates).not.toHaveBeenCalled();
    expect(await f.store.get(scope, "run")).toMatchObject({ status: "cancelled", attempts: 0, cancellationReason: "configuration_changed" });
  });

});

function mediaPost(id: string, version: string): CreatorUpdatePage["previews"][number] {
  return { platform: "youtube", contentId: id, canonicalUrl: `https://example.com/post/${id}`, text: "post",
    author: { id: "author", displayName: "Author" }, media: [{ id: `media-${id}`, kind: "image",
      sourceUrl: `https://cdn.example.com/${id}?signature=${version}`, downloadUrlExpiresAt: "2026-10-20T00:00:00Z",
      downloadHeaders: { Referer: "https://example.com/" } }] };
}
async function storedRows(name: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("agentlens-obsidian-operations-v1");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(name), read = tx.objectStore(name).getAll();
      read.onsuccess = () => resolve(read.result);
      tx.oncomplete = () => db.close();
    };
  });
}

it("keeps scoped recovery URLs across restart, redacts history and releases completed sources", async () => {
  const f = await fixture();
  const post = mediaPost("post", "original");
  f.api.creatorUpdates.mockResolvedValue({ ...page(), previews: [post] });
  await f.executor().run(scope, "run");
  const reopened = new OperationStore("executor");
  expect((await reopened.pendingPages(scope))[0]!.page.previews).toEqual([post]);
  expect(await reopened.pendingPages({ ...scope, userId: "other" })).toEqual([]);
  expect(JSON.stringify(await storedRows("pages"))).not.toContain("signature=");
  expect(JSON.stringify(await storedRows("pages"))).not.toContain("Referer");
  await reopened.settlePage(scope, "run", 1);
  expect(await storedRows("deliverySources")).toEqual([]);
});

it("refreshes all matching media atomically while preserving original run, target and attempt identity", async () => {
  const f = await fixture();
  f.api.creatorUpdates.mockResolvedValue({ ...page(), previews: [mediaPost("one", "old"), mediaPost("two", "old")] });
  await f.executor().run(scope, "run");
  expect(await f.store.beginPage(scope, "run", 1, 0, Date.parse(now))).toBe(true);
  await f.store.failPage(scope, "run", 1, 1, true);
  expect(await f.store.pendingPages(scope)).toEqual([]);
  const watermark = (await f.store.watermark(scope))!;
  await f.store.admit(scope, watermark.version, watermark, [operation("new-run")]);
  f.api.creatorUpdates.mockResolvedValue({ ...page("new-run"), previews: [mediaPost("one", "fresh"), mediaPost("two", "fresh")] });
  await f.executor().run(scope, "new-run");
  const recovered = (await new OperationStore("executor").pendingPages(scope)).find(item => item.operationId === "run")!;
  expect(recovered.page.fetchRunId).toBe("run");
  expect(recovered.snapshot.saveFolderPath).toBe("Research");
  expect(recovered.attempts).toBe(1);
  expect(recovered.page.previews.map(post => post.media[0]!.sourceUrl)).toEqual([
    "https://cdn.example.com/one?signature=fresh", "https://cdn.example.com/two?signature=fresh"
  ]);
  expect(await f.store.beginPage(scope, "run", 1, 1, Date.parse(now))).toBe(true);
});

it("does not move a pending repair to a changed destination", async () => {
  const f = await fixture();
  f.api.creatorUpdates.mockResolvedValue({ ...page(), previews: [mediaPost("post", "old")] });
  await f.executor().run(scope, "run");
  await f.store.beginPage(scope, "run", 1, 0, Date.parse(now));
  await f.store.failPage(scope, "run", 1, 1, true);
  const watermark = (await f.store.watermark(scope))!;
  const changed = { ...creator, saveFolderPath: "Other" };
  await f.store.admit(scope, watermark.version, watermark, [{ ...operation("new-run"), snapshot: changed }]);
  f.setContext({ creator: changed });
  f.api.creatorUpdates.mockResolvedValue({ ...page("new-run"), previews: [mediaPost("post", "fresh")] });
  await f.executor().run(scope, "new-run");
  expect((await f.store.pendingPages(scope)).map(item => item.operationId)).toEqual(["new-run"]);
});

it("does not grant a seventh write after the last attempt crashes with an unknown outcome", async () => {
  const f = await fixture();
  await f.executor().run(scope, "run");
  for (let attempt = 0; attempt < 6; attempt++) {
    expect(await f.store.beginPage(scope, "run", 1, attempt, Date.parse(now) + attempt * 300_000)).toBe(true);
    if (attempt < 5) await f.store.failPage(scope, "run", 1, attempt + 1, false);
  }
  expect(await new OperationStore("executor").beginPage(scope, "run", 1, 6, Date.parse(now) + 6 * 300_000)).toBe(false);
  expect(await storedRows("pages")).toEqual([expect.objectContaining({ deliveryStatus: "write_unknown", attempts: 6 })]);
});

it("does not reconcile another window's still-running source request", async () => {
  const f = await fixture();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  f.api.creatorUpdates.mockImplementationOnce(async () => { await gate; return page(); });
  const first = f.executor().run(scope, "run");
  await vi.waitFor(() => expect(f.api.creatorUpdates).toHaveBeenCalledTimes(1));
  expect(await f.executor().run(scope, "run")).toBe("deferred");
  expect(f.api.getExecution).not.toHaveBeenCalled();
  expect(f.api.inspectExecutionRecovery).not.toHaveBeenCalled();
  finish(); expect(await first).toBe("page_saved");
  expect((await f.store.get(scope, "run"))?.status).toBe("source_succeeded");
});

it("records scoped source outcomes without tokens and cannot be interrupted by a diagnostic observer", async () => {
  const { DiagnosticLog, enableDiagnostics } = await import("@/diagnostics/log");
  const f = await fixture();
  const log = new DiagnosticLog(`source-diagnostics-${crypto.randomUUID()}`);
  enableDiagnostics(log);
  try {
    expect(await f.executor().run(scope, "run")).toBe("page_saved");
    const rows = (await log.read(scope, 0)).events;
    expect(rows.filter(row => row.event.startsWith("source.")).map(row => row.event)).toEqual(["source.started", "source.finished"]);
    expect(rows.find(row => row.event === "source.finished")?.fields).toMatchObject({ creatorId: "creator", operationId: "run", result: "page_saved" });
    expect(rows.find(row => row.event === "operation.transition")?.fields).toMatchObject({ status: "running", operationId: "run" });
    expect(JSON.stringify(rows)).not.toMatch(/token|Research|youtube.com/);
    vi.spyOn(log, "record").mockImplementation(() => { throw new Error("observer failed"); });
    expect(await f.executor().run(scope, "run")).toBe("deferred");
    expect(f.api.creatorUpdates).toHaveBeenCalledTimes(1);
  } finally { enableDiagnostics(undefined); }
});

it("settles a missing destination before dispatch and never retries its source", async () => {
  const f = await fixture();const report = vi.fn().mockResolvedValue({chargedUnits:0});
  const executor = new SourceExecutor({store:f.store,api:{...f.api,reportDestinationFailure:report},
    destinationAvailable:async()=>false,context:async()=>({...scope,accessToken:"token",online:true,creator}),
    createId:()=>"unused",now:()=>new Date(now)});
  expect(await executor.run(scope,"run")).toBe("failed");expect(await executor.run(scope,"run")).toBe("deferred");
  expect(f.api.creatorUpdates).not.toHaveBeenCalled();expect(report).toHaveBeenCalledOnce();
  expect(await f.store.get(scope,"run")).toMatchObject({status:"failed",errorCode:"DESTINATION_PATH_INVALID",attempts:0});
  expect((await f.store.get(scope,"run"))?.dispatchedAt).toBeUndefined();
});

it("keeps the queued operation identity while adopting an explicitly shared new path",async()=>{
  const f=await fixture();const next={...creator,saveFolderPath:"Updated",configRevision:2};
  const executor=new SourceExecutor({store:f.store,api:f.api,sharedDestinationReady:async()=>true,destinationAvailable:async()=>true,
    context:async()=>({...scope,accessToken:"token",online:true,creator:next}),createId:()=>"same-request",now:()=>new Date(now)});
  expect(await executor.run(scope,"run")).toBe("page_saved");
  expect(f.api.creatorUpdates.mock.calls[0]).toEqual(["token",expect.objectContaining({leaseId:"run",saveFolderPath:"Updated"}),null,"same-request","auto-run-1"]);
  expect(await f.store.get(scope,"run")).toMatchObject({status:"source_succeeded",snapshot:{saveFolderPath:"Updated"}});
});
