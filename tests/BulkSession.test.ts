import { describe, expect, it, vi } from "vitest";
import { BulkSession } from "@/bulk/BulkSession";
import type { FetchPage } from "@/api/AgentLensApiClient";

function page(ids: string[], cursor: string | null, pageNumber: number): FetchPage {
  return {
    fetchId: `fetch-${pageNumber}`,
    mode: "profile_page",
    platform: "youtube",
    content: ids.map((id) => ({
      platform: "youtube",
      contentId: id,
      canonicalUrl: `https://youtube.com/watch?v=${id}`,
      text: id,
      author: { id: "creator-1", displayName: "Creator" },
      media: []
    })),
    page: { cursor, hasMore: cursor !== null, pageNumber },
    usage: { charged: true, units: 1, remaining: 99 - pageNumber }
  };
}

describe("BulkSession", () => {
  it("keeps stable selections across pages and merges duplicate rows", async () => {
    const session = new BulkSession();
    await session.load(null, async () => page(["a", "b"], "cursor-2", 1));
    session.toggle("youtube:a");
    await session.load("cursor-2", async () => page(["b", "c"], null, 2));

    expect(session.rows().map((item) => item.post.contentId)).toEqual(["a", "b", "c"]);
    expect(session.selected().map((item) => item.post.contentId)).toEqual(["a"]);
    expect(session.cursor()).toBeNull();
    expect(session.usageReceipts()).toEqual([
      { fetchId: "fetch-1", pageNumber: 1, charged: true, units: 1, remaining: 98 },
      { fetchId: "fetch-2", pageNumber: 2, charged: true, units: 1, remaining: 97 }
    ]);
  });

  it("deduplicates the same cursor while it is in flight", async () => {
    const session = new BulkSession();
    let release!: (value: FetchPage) => void;
    const loader = vi.fn(() => new Promise<FetchPage>((resolve) => { release = resolve; }));

    const first = session.load("cursor-2", loader);
    const second = session.load("cursor-2", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    release(page(["c"], null, 2));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("preserves earlier pages and selection when a later page fails", async () => {
    const session = new BulkSession();
    await session.load(null, async () => page(["a"], "cursor-2", 1));
    session.toggle("youtube:a");
    await expect(session.load("cursor-2", async () => { throw new Error("upstream timeout"); }))
      .rejects.toThrow("upstream timeout");

    expect(session.rows()).toHaveLength(1);
    expect(session.selected()).toHaveLength(1);
    expect(session.cursor()).toBe("cursor-2");

    const retry = vi.fn(async () => page(["b"], null, 2));
    await expect(session.load(session.cursor(), retry)).resolves.toMatchObject({ fetchId: "fetch-2" });
    expect(retry).toHaveBeenCalledExactlyOnceWith("cursor-2");
    expect(session.rows().map((item) => item.post.contentId)).toEqual(["a", "b"]);
    expect(session.selected().map((item) => item.post.contentId)).toEqual(["a"]);
  });

  it("supports deterministic bulk selection actions without changing loaded rows", async () => {
    const session = new BulkSession();
    await session.load(null, async () => page(["a", "b", "c"], null, 1));

    session.selectAll(["youtube:a", "youtube:c", "youtube:missing"]);
    expect(session.selected().map((item) => item.post.contentId)).toEqual(["a", "c"]);

    session.selectOnly(["youtube:b"]);
    expect(session.selected().map((item) => item.post.contentId)).toEqual(["b"]);

    session.clearSelection();
    expect(session.selected()).toEqual([]);
    expect(session.rows().map((item) => item.post.contentId)).toEqual(["a", "b", "c"]);
  });
});

describe("selected article details", () => {
  function articlePage() {
    const listing = page(["article"], null, 1);
    listing.content = listing.content.map(post => ({ ...post, needSupplement: true, platform: "wechat_official_account", canonicalUrl: "https://mp.weixin.qq.com/s/article", text: "Article title", title: undefined }));
    return listing;
  }
  it("fetches full text once, retains selection and uses the detail receipt for saving", async () => {
    const session = new BulkSession();
    const listing = articlePage();
    await session.load(null, async () => listing);
    session.toggle("wechat_official_account:article");
    const detail = { post: { ...listing.content[0]!, needSupplement: false, title: "Article title", body: "Full article\nSecond paragraph", text: "Full article\nSecond paragraph" }, fetchId: listing.fetchId, demo: false };
    const loader = vi.fn(async () => detail);
    await Promise.all([session.supplement("wechat_official_account:article", loader), session.supplement("wechat_official_account:article", loader)]);
    await session.supplement("wechat_official_account:article", loader);
    await session.load("next", async () => listing);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0]).toBeDefined();
    expect(session.selected()[0]).toMatchObject(detail);
  });
  it("refuses title-only and mismatched responses and allows an explicit retry", async () => {
    const session = new BulkSession(); const listing = articlePage();
    await session.load(null, async () => listing);
    const loader = vi.fn(async () => ({ post: { ...listing.content[0]!, needSupplement: false }, fetchId: listing.fetchId, demo: false }));
    await expect(session.supplement("wechat_official_account:article", loader)).rejects.toThrow("full article");
    loader.mockResolvedValueOnce({ post: { ...listing.content[0]!, needSupplement: false, contentId: "other", text: "Full text" }, fetchId: listing.fetchId, demo: false });
    await expect(session.supplement("wechat_official_account:article", loader)).rejects.toThrow("does not match");
    expect(session.rows()[0]?.post.text).toBe("Article title");
    loader.mockResolvedValueOnce({ post: { ...listing.content[0]!, needSupplement: false, text: "The complete article content" }, fetchId: listing.fetchId, demo: false });
    await expect(session.supplement("wechat_official_account:article", loader)).resolves.toMatchObject({ post: { text: "The complete article content" } });
  });
});

it("does not restore stale article details after the list is reset", async () => {
  const session = new BulkSession();
  const listing = page(["a"], null, 1);
  listing.content = listing.content.map(post => ({...post, platform: "wechat_official_account", needSupplement: true}));
  await session.load(null, async () => listing);
  let finish!: (value: import("@/workbench/types").PreviewResult) => void;
  const pending = session.supplement("wechat_official_account:a", () => new Promise(resolve => { finish = resolve; }));
  session.reset();
  finish({post:{...listing.content[0]!,text:"Full article"},demo:false});
  await expect(pending).rejects.toThrow("list changed");
  expect(session.rows()).toEqual([]);
});

it("rejects a repeated cursor without discarding the loaded selection", async () => {
  const session = new BulkSession();
  await session.load(null, async () => page(["a"], "next", 1));
  session.toggle("youtube:a");
  await expect(session.load("next", async () => page(["b"], "next", 2))).rejects.toThrow("did not advance");
  expect(session.rows().map(row => row.post.contentId)).toEqual(["a"]);
  expect(session.selected()).toHaveLength(1);
  expect(session.cursor()).toBe("next");
});

it("isolates page requests across reset and preserves the new in-flight request", async () => {
  const session = new BulkSession();
  let release!: (value: FetchPage) => void;
  const stale = session.load(null, () => new Promise(resolve => { release = resolve; }));
  session.reset();
  await session.load(null, async () => page(["new"], null, 1));
  release(page(["old"], null, 1));
  await expect(stale).rejects.toThrow("list has changed");
  expect(session.rows().map(row => row.post.contentId)).toEqual(["new"]);
});

it("preserves an article listing cover independently from detail attachments", async () => {
  const session = new BulkSession();
  const listing = page(["article"], null, 1);
  listing.content = [{ ...listing.content[0]!, platform: "wechat_official_account", needSupplement: true, text: "Summary",
    media: [{id:"cover",kind:"image",sourceUrl:"https://cdn.example/cover.jpg"}] }];
  await session.load(null, async () => listing);
  const result = await session.supplement("wechat_official_account:article", async () => ({
    fetchId:listing.fetchId,demo:false,post:{...listing.content[0]!,needSupplement:false,text:"Full article body",media:[
      {id:"body-image",kind:"image",sourceUrl:"https://cdn.example/body.jpg"}]} }));
  expect(result.post.thumbnailUrl).toBe("https://cdn.example/cover.jpg");
  expect(result.post.media.map(item => item.id)).toEqual(["body-image"]);
  expect(result.fetchId).toBe(listing.fetchId);
});


it("retains completed media, cover, selection and receipt when a later page repeats a placeholder", async () => {
  const session = new BulkSession();
  const first = page(["a"], "next", 1);
  first.content = [{ ...first.content[0]!, needSupplement: false, thumbnailUrl: "https://cdn.example/cover.jpg",
    media: [{ id: "video", kind: "video", sourceUrl: "https://cdn.example/video.mp4" }] }];
  await session.load(null, async () => first);
  session.toggle("youtube:a");
  const original = session.selected()[0];
  const next = page(["a", "b"], null, 2);
  next.content = next.content.map(post => ({ ...post, needSupplement: true }));
  await session.load("next", async () => next);
  expect(session.selected()[0]).toBe(original);
  expect(session.rows()[0]).toMatchObject({ fetchId: "fetch-1", post: { needSupplement: false,
    thumbnailUrl: "https://cdn.example/cover.jpg", media: [{id: "video"}] } });
  expect(session.rows()).toHaveLength(2);
  expect(session.usageReceipts()).toHaveLength(2);
});

it("allows an in-flight detail to finish when pagination repeats its post", async () => {
  const session = new BulkSession();
  const first = page(["a"], "next", 1);
  first.content = first.content.map(post => ({ ...post, needSupplement: true }));
  await session.load(null, async () => first);
  let finish!: (value: import("@/workbench/types").PreviewResult) => void;
  const pending = session.supplement("youtube:a", () => new Promise(resolve => { finish = resolve; }));
  await session.load("next", async () => page(["a", "b"], null, 2));
  finish({ fetchId: first.fetchId, demo: false, post: { ...first.content[0]!, needSupplement: false, text: "Full details" } });
  await expect(pending).resolves.toMatchObject({ fetchId: first.fetchId, post: { text: "Full details" } });
  expect(session.rows()[0]?.post.text).toBe("Full details");
});


describe("history restore", () => {
  it("preserves the original result and receipt but cannot paginate or supplement", async () => {
    const session = new BulkSession();
    const original = { ...page(["a"], "next-original-page", 2), historyRestore: true };
    original.content = original.content.map(post => ({ ...post, needSupplement: true }));
    await session.load(null, async () => original);
    expect(session.rows()[0]).toMatchObject({ fetchId: "fetch-2", historyRestore: true, usage: original.usage });
    expect(session.cursor()).toBeNull();
    const upstream = vi.fn();
    await expect(session.supplement("youtube:a", upstream)).rejects.toThrow("never requests new details");
    expect(upstream).not.toHaveBeenCalled();
  });
});
