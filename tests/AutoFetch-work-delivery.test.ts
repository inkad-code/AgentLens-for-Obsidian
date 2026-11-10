import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { OperationStore, type SourceOperation } from "@/auto-fetch/operation-store";
import type { CreatorUpdatePage } from "@/api/AgentLensApiClient";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
const scope = { userId: "user", installationId: "vault", creatorId: "creator" };
const at = "2026-10-19T00:00:00Z";
const snapshot: SourceOperation["snapshot"] = { creatorId: "creator", platform: "youtube", profileUrl: "https://youtube.com/@test",
  displayName: "Test", saveFolderPath: "Research", noteTemplateId: "default", mediaPolicy: "download_all",
  autoFetchEnabled: true, frequency: { every: 1, unit: "hour" }, timezone: "UTC", preferredTimes: [] };
const post = (id: string, token = "original") => ({ platform: "youtube", contentId: id, canonicalUrl: `https://example.com/${id}`,
  text: id, author: { id: "author", displayName: "Author" }, media: [{ id: `${id}-image`, kind: "image" as const,
    sourceUrl: `https://cdn.example.com/${id}?token=${token}` }] });
async function accept(store: OperationStore, id: string, ids: string[], token = "original", previews?: CreatorUpdatePage["previews"]) {
  const watermark = await store.watermark(scope);
  await store.admit(scope, watermark?.version, { configRevision: 1, observedThrough: at }, [{ operationId: id,
    admissionKey: id, configRevision: 1, trigger: "normal", snapshot, coverage: [], status: "queued", attempts: 0, version: 0, queuedAt: at }]);
  await store.transition(scope, id, 0, { status: "running", executionStartedAt: at, dispatchedAt: at, attemptKey: `attempt-${id}` });
  const page: CreatorUpdatePage = { creatorId: "creator", fetchRunId: id, leaseId: id, fetchId: `fetch-${id}`, requestId: `request-${id}`,
    previews: previews ?? ids.map(value => post(value, token)), cursor: null, hasMore: false, coverageComplete: true, truncated: false, stopReason: "done" };
  await store.acceptPage(scope, id, 1, page, at);
}
it("keeps mixed work outcomes independent across restart and repairs only the expired work under its original identity", async () => {
  const store = new OperationStore("mixed");
  await accept(store, "old", ["expired", "temporary", "unknown", "saved"]);
  const first = await store.pendingDeliveries(scope, 2);
  const second = await store.pendingDeliveries(scope, 2, Number.MAX_SAFE_INTEGER, "pending", first[1]);
  expect(new Set([...first, ...second].map(row => row.itemKey)).size).toBe(4);
  for (const row of [...first, ...second]) {
    expect(row.page.previews).toHaveLength(1);
    expect(row.page.deliveryItemCount).toBe(4);
    expect(await store.beginPage(scope, "old", 1, 0, 0, row.itemKey)).toBe(true);
    if (row.itemKey === "youtube:saved") await store.settlePage(scope, "old", 1, 1, row.itemKey);
    else await store.failPage(scope, "old", 1, 1, row.itemKey === "youtube:expired", row.itemKey === "youtube:unknown", row.itemKey);
  }
  const reopened = new OperationStore("mixed");
  expect(await reopened.pendingDeliveries(scope, 8, 299999)).toEqual([]);
  const due = await reopened.pendingDeliveries(scope, 8, 300000);
  expect(due.map(row => row.itemKey)).toEqual(["youtube:temporary"]);
  expect(due[0]?.page.previews[0]?.media[0]?.sourceUrl).toContain("token=original");
  expect(await reopened.beginPage(scope, "old", 1, 1, 300000, "youtube:temporary")).toBe(true);
  await reopened.settlePage(scope, "old", 1, 2, "youtube:temporary");
  await accept(reopened, "fresh", ["expired", "unknown", "saved"], "fresh");
  const repaired = (await reopened.pendingDeliveries(scope)).find(row => row.operationId === "old")!;
  expect(repaired).toMatchObject({ operationId: "old", itemKey: "youtube:expired", attempts: 1,
    page: { fetchId: "fetch-old", requestId: "request-old", leaseId: "old" } });
  expect(repaired.page.previews[0]?.media[0]?.sourceUrl).toContain("token=fresh");
  const unknown = await reopened.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown");
  expect(unknown).toHaveLength(1);
  expect(unknown[0]?.page.previews[0]?.media[0]?.sourceUrl).toContain("token=original");
  expect(await reopened.beginPage(scope, "old", 1, 1, 300000, "youtube:expired")).toBe(true);
  await reopened.settlePage(scope, "old", 1, 2, "youtube:expired");
  expect(await reopened.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toHaveLength(1);
  await reopened.settlePage(scope, "old", 1, 1, "youtube:unknown");
  expect(await reopened.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toEqual([]);
  expect((await reopened.pendingDeliveries(scope)).every(row => row.operationId === "fresh")).toBe(true);
});

it("bounds retries independently and does not consume another work's attempts", async () => {
  const store = new OperationStore("budget");
  await accept(store, "run", ["retry", "waiting"]);
  for (let attempt = 0; attempt < 6; attempt++) {
    expect(await store.beginPage(scope, "run", 1, attempt, attempt * 300000, "youtube:retry")).toBe(true);
    await store.failPage(scope, "run", 1, attempt + 1, false, false, "youtube:retry");
  }
  expect(await store.beginPage(scope, "run", 1, 6, 1800000, "youtube:retry")).toBe(false);
  expect((await store.pendingDeliveries(scope))[0]).toMatchObject({ itemKey: "youtube:waiting", attempts: 0 });
  expect((await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "retry_exhausted"))[0])
    .toMatchObject({ itemKey: "youtube:retry", attempts: 6 });
});

it("retains individual failed media identities and kinds across restart without persisting display messages", async () => {
  const store = new OperationStore("media-evidence");
  await accept(store, "run", ["post"]);
  await store.beginPage(scope, "run", 1, 0, 0, "youtube:post");
  const evidence = [{ mediaId: "expired", kind: "source_expired" as const }, { mediaId: "temporary", kind: "retryable" as const }];
  await store.failPage(scope, "run", 1, 1, true, false, "youtube:post", evidence);
  const reopened = new OperationStore("media-evidence");
  expect((await reopened.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "pending"))[0]?.mediaFailures).toEqual(evidence);
});

it("retries temporary media independently while expired media wait, and preserves exhausted budgets on fresh links", async () => {
  const store = new OperationStore("independent-media");
  await accept(store, "run", ["post"]);
  const expired = { mediaId: "post-image", kind: "source_expired" as const };
  const temporary = { mediaId: "temporary", kind: "retryable" as const };
  await store.beginPage(scope, "run", 1, 0, 0, "youtube:post");
  await store.failPage(scope, "run", 1, 1, true, false, "youtube:post", [expired, temporary]);
  for (let attempt = 1; attempt < 6; attempt++) {
    const [work] = await new OperationStore("independent-media").pendingDeliveries(scope, 8, attempt * 300000);
    expect(work?.page.deliveryDeferredMedia).toEqual([{ ...expired, deferred: true }]);
    expect(await store.beginPage(scope, "run", 1, attempt, attempt * 300000, "youtube:post")).toBe(true);
    await store.failPage(scope, "run", 1, attempt + 1, true, false, "youtube:post", [{ ...expired, deferred: true }, temporary]);
  }
  expect(await store.pendingDeliveries(scope)).toEqual([]);
  expect(await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "needs_refetch")).toHaveLength(1);
  expect(await store.creatorStatus(scope, "Research")).toMatchObject({ writeFailed: true });
  expect((await store.taskHistory(scope, "Research")).items[0]?.delivery).toMatchObject({
    pending: false, needs_refetch: true, retry_exhausted: true,
  });
  await accept(store, "fresh", ["post"], "new-link");
  const repaired = (await store.pendingDeliveries(scope, 8, 1800000)).find(row => row.operationId === "run")!;
  expect(repaired.attempts).toBe(6);
  expect(repaired.page.deliveryDeferredMedia).toEqual([{ ...temporary, deferred: true }]);
  // Only the source-expired attachment received a new budget. Six failed temporary downloads remain exhausted.
  expect(await store.beginPage(scope, "run", 1, 6, 1800000, "youtube:post")).toBe(true);
  await store.failPage(scope, "run", 1, 7, false, false, "youtube:post", [{ ...temporary, deferred: true }]);
  expect((await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "retry_exhausted"))[0]?.operationId).toBe("run");
});

it("preserves original text and media order while refreshing only matching media identities and types", async () => {
  const store = new OperationStore("manifest-repair");
  const original = { ...post("post"), text: "Original body", media: ["a", "b", "c"].map(id => ({
    id, kind: "image" as const, sourceUrl: `https://old.example/${id}`, filename: `${id}.png` })) };
  await accept(store, "old", ["post"], "original", [original]);
  await store.beginPage(scope, "old", 1, 0, 0, "youtube:post");
  await store.failPage(scope, "old", 1, 1, true, false, "youtube:post",
    original.media.map(media => ({ mediaId: media.id, kind: "source_expired" })));
  await accept(store, "fresh", ["post"], "fresh", [{ ...post("post"), text: "Changed body", media: [
    { id: "new", kind: "image", sourceUrl: "https://new.example/new" },
    { id: "c", kind: "video", sourceUrl: "https://new.example/c" },
    { id: "a", kind: "image", sourceUrl: "https://new.example/a", filename: "changed.png" },
  ] }]);
  const row = (await store.pendingDeliveries(scope)).find(row => row.operationId === "old")!;
  expect(row.page.previews[0]).toEqual({ ...original, media: [
    { ...original.media[0], sourceUrl: "https://new.example/a" }, original.media[1], original.media[2],
  ] });
  expect(row.page.deliveryDeferredMedia).toEqual([
    { mediaId: "b", kind: "source_expired", deferred: true }, { mediaId: "c", kind: "source_expired", deferred: true },
  ]);
  await store.beginPage(scope, "old", 1, 1, 0, "youtube:post");
  await store.failPage(scope, "old", 1, 2, true, false, "youtube:post", row.page.deliveryDeferredMedia);
  expect((await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "needs_refetch"))[0]?.operationId).toBe("old");
  await accept(store, "later", ["post"], "later", [{ ...original, media: original.media.map(media => ({ ...media, sourceUrl: `https://later.example/${media.id}` })) }]);
  expect((await store.pendingDeliveries(scope)).find(row => row.operationId === "old")?.page.deliveryDeferredMedia).toEqual([]);
});

it("refreshes matching expired tasks beyond the first hundred repair links", async () => {
  const store = new OperationStore("many-repairs");
  for (let i = 0; i < 101; i++) await accept(store, `old-${i}`, ["post"]);
  for (let i = 0; i < 101; i++) {
    const id = `old-${i}`;
    await store.beginPage(scope, id, 1, 0, 0, "youtube:post");
    await store.failPage(scope, id, 1, 1, true, false, "youtube:post", [{ mediaId: "post-image", kind: "source_expired" }]);
  }
  await accept(store, "fresh", ["post"], "renewed");
  expect(await store.pendingDeliveries(scope, 100, Number.MAX_SAFE_INTEGER, "needs_refetch")).toEqual([]);
  const first = await store.pendingDeliveries(scope, 100);
  const rows = [...first, ...await store.pendingDeliveries(scope, 100, Number.MAX_SAFE_INTEGER, "pending", first[99])];
  expect(rows).toHaveLength(102);
  expect(rows.every(row => row.page.previews[0]?.media[0]?.sourceUrl.includes("renewed"))).toBe(true);
});

it("does not reopen a settled work while repairing another work on the same original page", async () => {
  const store = new OperationStore("settled-repair");
  await accept(store, "old", ["saved", "expired"]);
  for (const id of ["saved", "expired"]) {
    await store.beginPage(scope, "old", 1, 0, 0, `youtube:${id}`);
    await store.failPage(scope, "old", 1, 1, true, false, `youtube:${id}`, [{ mediaId: `${id}-image`, kind: "source_expired" }]);
  }
  await store.settlePage(scope, "old", 1, 1, "youtube:saved");
  await accept(store, "fresh", ["saved", "expired"], "fresh");
  const old = (await store.pendingDeliveries(scope)).filter(row => row.operationId === "old");
  expect(old.map(row => row.itemKey)).toEqual(["youtube:expired"]);
  const detail = await store.taskDetail(scope, "Research", "old");
  expect(detail?.pages[0]?.works.find(work => work.contentKey === "youtube:saved")).toMatchObject({
    status: "settled", media: [{ mediaId: "saved-image", status: "settled" }],
  });
  expect(detail?.task.delivery).toMatchObject({ pending: true, settled: true, needs_refetch: false });
  expect(await store.creatorStatus(scope, "Research")).not.toMatchObject({ writeFailed: true });
});
