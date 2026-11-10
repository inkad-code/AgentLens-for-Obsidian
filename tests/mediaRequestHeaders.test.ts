import { describe, expect, it } from "vitest";
import { mediaRequestHeaders } from "../src/vault/mediaRequestHeaders";

describe("Bilibili CDN download headers", () => {
  const media = { id: "video", kind: "video" as const, sourceUrl: "https://upos-sz-mirrorcos.bilivideo.com/video.mp4" };
  it("supplies the public Referer required for list and single-post videos", () => {
    expect(mediaRequestHeaders(media)).toEqual({ Referer: "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0" });
  });
  it("supplies headers for the Bilibili Akamai mirror returned by profile lists", () => {
    expect(mediaRequestHeaders({ ...media, sourceUrl: "https://upos-hz-mirrorakam.akamaized.net/video.mp4" })).toEqual({ Referer: "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0" });
  });
  it("preserves explicit provider headers without mutating them", () => {
    const downloadHeaders = Object.freeze({ referer: "https://www.bilibili.com/video/example", "User-Agent": "provider" });
    expect(mediaRequestHeaders({ ...media, downloadHeaders })).toEqual(downloadHeaders);
  });
  it.each(["https://bilivideo.com.example/video", "https://evilbilivideo.com/video", "https://example.com/video", "https://other.akamaized.net/video", "https://upos-hz-mirrorakam.akamaized.net.example/video", "http://cdn.bilivideo.com/video"])("does not add a Referer to %s", sourceUrl => {
    expect(mediaRequestHeaders({ ...media, sourceUrl })).toEqual({});
  });
});
