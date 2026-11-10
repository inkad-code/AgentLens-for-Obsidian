import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { OperationStore, type OperationScope, type SourceOperation } from "@/auto-fetch/operation-store";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
const scope: OperationScope = { userId: "owner", installationId: "vault", creatorId: "creator" };
const at = "2026-10-19T00:00:00Z";
function operation(id: string, folder = "Research"): SourceOperation {
  return { operationId: id, admissionKey: id, trigger: "normal", configRevision: 1, coverage: [],
    queuedAt: at, status: "queued", version: 0, attempts: 0,
    snapshot: { creatorId: "creator", platform: "youtube", profileUrl: "https://example.com/private-profile",
      displayName: "Private display name", saveFolderPath: folder, autoFetchEnabled: true,
      frequency: { every: 1, unit: "hour" }, timezone: "UTC", preferredTimes: [] } };
}
async function admit(store: OperationStore, tasks: SourceOperation[]) {
  await store.admit(scope, (await store.watermark(scope))?.version, { configRevision: 1, observedThrough: at }, tasks);
}
it("paginates all original task states newest first without leaking other accounts or destinations", async () => {
  const store = new OperationStore("history");
  await admit(store, [operation("a"), operation("foreign-target", "Other"), operation("b"), operation("c")]);
  const first = await store.taskHistory(scope, "Research", 2);
  expect(first.items.map(item => item.operationId)).toEqual(["c", "b"]);
  await store.transition(scope, "a", 0, { status: "running", attemptKey: "attempt", executionStartedAt: at, dispatchedAt: at });
  await store.transition(scope, "a", 1, { status: "failed" });
  await admit(store, [operation("new")]);
  const next = await new OperationStore("history").taskHistory(scope, "Research", 2, first.next);
  expect(next.items).toMatchObject([{ operationId: "a", sourceStatus: "failed" }]);
  expect(next.next).toBeUndefined();
  expect(JSON.stringify(first)).not.toMatch(/private-profile|Private display name|snapshot|admissionKey/);
  for (const other of [{ ...scope, userId: "other" }, { ...scope, installationId: "other" }, { ...scope, creatorId: "other" }]) {
    expect((await store.taskHistory(other, "Research")).items).toEqual([]);
    expect(await store.taskDetail(other, "Research", "a")).toBeUndefined();
  }
  expect(await store.taskDetail(scope, "Other", "a")).toBeUndefined();
  expect((await new OperationStore("other-namespace").taskHistory(scope, "Research")).items).toEqual([]);
});

it("reads bounded original page evidence, retaining settled and failed works without exposing recovery payloads", async () => {
  const store = new OperationStore("detail");
  await admit(store, [operation("run")]);
  await store.transition(scope, "run", 0, { status: "running", attemptKey: "attempt", executionStartedAt: at, dispatchedAt: at });
  const page = (number: number) => ({ creatorId: "creator", fetchRunId: "run", leaseId: "lease", fetchId: `fetch-${number}`,
    requestId: `request-${number}`, hasMore: number === 1, cursor: number === 1 ? "private-cursor" : null,
    coverageComplete: true, truncated: false, stopReason: "done",
    previews: [{ platform: "youtube", contentId: `post-${number}`, canonicalUrl: "https://example.com/post",
      text: "PRIVATE BODY", author: { id: "author", displayName: "Private author" }, media: [{ id: "media", kind: "image" as const,
        sourceUrl: "https://cdn.example.com/image?token=SECRET", downloadHeaders: { Authorization: "SECRET" } }] }] });
  await store.acceptPage(scope, "run", 1, page(1), at);
  await store.transition(scope, "run", 2, { status: "running", attemptKey: "attempt", executionStartedAt: at, dispatchedAt: at });
  await store.acceptPage(scope, "run", 3, page(2), at);
  await store.beginPage(scope, "run", 1, 0, 0, "youtube:post-1");
  await store.failPage(scope, "run", 1, 1, true, false, "youtube:post-1", [{ mediaId: "media", kind: "source_expired" }]);
  await store.settlePage(scope, "run", 2, 0, "youtube:post-2");
  const first = await store.taskDetail(scope, "Research", "run", 1);
  expect(first?.task.sourceStatus).toBe("source_succeeded");
  expect(first?.pages).toMatchObject([{ pageNumber: 1, works: [{ status: "needs_refetch", media: [{ mediaId: "media", status: "needs_refetch" }] }] }]);
  expect(first?.next).toEqual({ pageNumber: 1 });
  const second = await new OperationStore("detail").taskDetail(scope, "Research", "run", 1, first?.next);
  expect(second?.pages).toMatchObject([{ pageNumber: 2, works: [{ status: "settled" }] }]);
  expect(second?.next).toBeUndefined();
  // Failure on page one still contributes while the visible detail contains only settled page two.
  expect(second?.task.delivery).toEqual({ pending: false, write_unknown: false, needs_refetch: true,
    retry_exhausted: false, settled: true });
  const history = await store.taskHistory(scope, "Research");
  expect(history.items[0]?.delivery).toEqual(second?.task.delivery);
  expect((await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "needs_refetch"))[0]?.page.previews[0]?.text).toBe("PRIVATE BODY");
  await store.settlePage(scope, "run", 1, 1, "youtube:post-1");
  expect((await store.taskHistory(scope, "Research")).items[0]?.delivery.needs_refetch).toBe(false);
  expect(JSON.stringify([first, second])).not.toMatch(/PRIVATE|SECRET|cdn.example|private-cursor|Private author/);
});

it("rejects unbounded reads and invalid continuation positions", async () => {
  const store = new OperationStore("limits");
  for (const limit of [0, 101, Infinity, 1.5]) {
    await expect(store.taskHistory(scope, "Research", limit)).rejects.toThrow();
    await expect(store.taskDetail(scope, "Research", "run", limit)).rejects.toThrow();
  }
  await expect(store.taskHistory(scope, "Research", 1, { sequence: NaN })).rejects.toThrow();
  await expect(store.taskDetail(scope, "Research", "run", 1, { pageNumber: -1 })).rejects.toThrow();
});
