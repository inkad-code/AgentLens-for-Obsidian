import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { MOBILE_MEDIA_DOWNLOAD_LIMIT } from "@/core/platformPolicy";
import { ObsidianMediaDownloader } from "@/vault/ObsidianMediaDownloader";

function response(status: number, bytes: number): RequestUrlResponse {
  return {
    status,
    headers: {},
    text: "",
    json: null,
    arrayBuffer: new ArrayBuffer(bytes)
  };
}

describe("ObsidianMediaDownloader", () => {
  it("passes provider download headers without logging or persisting them", async () => {
    const send = vi.fn(async (_request: RequestUrlParam | string) => response(200, 3));
    const downloader = new ObsidianMediaDownloader(10, send);

    await expect(downloader.download({
      id: "media-1",
      kind: "image",
      sourceUrl: "https://cdn.example/image",
      downloadHeaders: { Referer: "https://source.example/" }
    })).resolves.toHaveProperty("byteLength", 3);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      headers: { Referer: "https://source.example/" }
    }));
  });

  it("rejects declared or actual media above the host limit", async () => {
    const send = vi.fn(async (_request: RequestUrlParam | string) => response(200, 11));
    const downloader = new ObsidianMediaDownloader(10, send);

    await expect(downloader.download({
      id: "large-declared",
      kind: "video",
      sourceUrl: "https://cdn.example/large",
      sizeBytes: 11
    })).rejects.toThrow(/exceeds/);
    expect(send).not.toHaveBeenCalled();

    await expect(downloader.download({
      id: "large-actual",
      kind: "video",
      sourceUrl: "https://cdn.example/large"
    })).rejects.toThrow(/exceeds/);
  });
});



describe("Eagle media integrity parity", () => {
  const media = { id: "video", kind: "video", sourceUrl: "https://cdn.example/video.mp4" } as const;
  it.each([
    ["empty", "", {}],
    ["HTML disguised as video", "<!DOCTYPE html><html>Error</html>", { "Content-Type": "video/mp4" }],
    ["playlist disguised as binary", "#EXTM3U\n#EXT-X-VERSION:3", { "Content-Type": "application/octet-stream" }],
    ["JSON error", '{"error":"expired"}', { "Content-Type": "application/json" }],
    ["truncated", "abc", { "Content-Length": "100" }],
    ["excess bytes", "abc", { "content-length": "2" }]
  ])("rejects %s before Vault persistence", async (_label, content, headers) => {
    const bytes = new TextEncoder().encode(content).buffer;
    const send = vi.fn(async () => ({ ...response(200, 0), headers, arrayBuffer: bytes } as RequestUrlResponse));
    await expect(new ObsidianMediaDownloader(1024, send).download(media)).rejects.toThrow();
  });

  it("accepts decoded compressed media without comparing compressed length", async () => {
    const send = vi.fn(async () => ({ ...response(200, 3), headers: { "Content-Length": "2", "Content-Encoding": "gzip" } }));
    await expect(new ObsidianMediaDownloader(1024, send).download(media)).resolves.toHaveProperty("byteLength", 3);
  });
});

it("stops waiting for an in-flight host request on cancellation and ignores late bytes", async () => {
  let finish!: (value: RequestUrlResponse) => void;
  const send = vi.fn(() => new Promise<RequestUrlResponse>(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const download = new ObsidianMediaDownloader(100, send).download({ id: "v", kind: "video", sourceUrl: "https://cdn.example/v.mp4" }, controller.signal);
  controller.abort();
  await expect(download).rejects.toMatchObject({ name: "AbortError" });
  finish(response(200, 3));
  expect(send).toHaveBeenCalledTimes(1);
});

it("finishes a save as partial when the host media request never settles", async () => {
  vi.useFakeTimers();
  try {
    const send = vi.fn(() => new Promise<RequestUrlResponse>(() => {}));
    const download = new ObsidianMediaDownloader(100, send).download({ id: "v", kind: "video", sourceUrl: "https://cdn.example/v.mp4" });
    const outcome = expect(download).rejects.toThrow("Media download timed out");
    await vi.advanceTimersByTimeAsync(120_000);
    await outcome;
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  ["DASH manifest", "<MPD><Period/></MPD>", "application/octet-stream"],
  ["XML error", "<?xml version=\"1.0\"?><Error/>", "application/octet-stream"],
  ["thumbnail instead of video", "binary-image", "image/jpeg"],
  ["audio instead of video", "binary-audio", "audio/mpeg"]
])("rejects %s instead of reporting a saved video", async (_label, content, contentType) => {
  const send = vi.fn(async () => ({ ...response(200, 0), headers: {"Content-Type":contentType}, arrayBuffer:new TextEncoder().encode(content).buffer }));
  await expect(new ObsidianMediaDownloader(1024, send).download({id:"v",kind:"video",sourceUrl:"https://cdn.example/v"})).rejects.toThrow();
});


it("accepts exactly 50 MiB on mobile and rejects one byte above it", async () => {
  const media = { id: "mobile-boundary", kind: "video", sourceUrl: "https://cdn.example/video" } as const;
  const send = vi.fn(async () => response(200, MOBILE_MEDIA_DOWNLOAD_LIMIT));
  const downloader = new ObsidianMediaDownloader(MOBILE_MEDIA_DOWNLOAD_LIMIT, send);
  expect(MOBILE_MEDIA_DOWNLOAD_LIMIT).toBe(52_428_800);
  await expect(downloader.download({ ...media, sizeBytes: MOBILE_MEDIA_DOWNLOAD_LIMIT })).resolves.toHaveProperty("byteLength", 52_428_800);
  send.mockClear();
  await expect(downloader.download({ ...media, sizeBytes: MOBILE_MEDIA_DOWNLOAD_LIMIT + 1 })).rejects.toThrow("exceeds");
  expect(send).not.toHaveBeenCalled();
  send.mockImplementation(async () => response(200, MOBILE_MEDIA_DOWNLOAD_LIMIT + 1));
  await expect(downloader.download(media)).rejects.toThrow("exceeds");
});

const recoveryPolicy = () => Promise.resolve({ version: 1, channel: "plugin_center" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(), allowedHosts: ["tiktok.com", "tiktokcdn.com", "agentlensapi.io"] });

describe("bounded 403 media recovery", () => {
  const media = { id: "original-media", kind: "video" as const, sourceUrl: "https://www.tiktok.com/aweme/v1/play/?video_id=original",
    downloadHeaders: { Cookie: "private", Authorization: "Bearer source", Referer: "https://www.tiktok.com/" } };
  it.each([false, true])("retries the original media once without source headers (host rejects=%s)", async rejects => {
    const send = vi.fn().mockImplementationOnce(async () => { if (rejects) throw { status: 403 }; return response(403, 0); })
      .mockResolvedValueOnce({ ...response(200, 3), headers: { "content-type": "video/mp4", "content-length": "3" } });
    const loadPolicy = vi.fn(recoveryPolicy);
    const progress = vi.fn();
    await expect(new ObsidianMediaDownloader(100, send, loadPolicy).download(media, undefined, progress)).resolves.toHaveProperty("byteLength", 3);
    expect(send).toHaveBeenCalledTimes(2);
    const recovered = send.mock.calls[1]![0] as RequestUrlParam;
    const url = new URL(recovered.url);
    expect(url.origin + url.pathname).toBe("https://m3u8.agentlensapi.io/downloader/media");
    expect(url.searchParams.get("url")).toBe(media.sourceUrl);
    expect(url.searchParams.get("mode")).toBe("passthrough");
    expect(recovered.headers).toEqual({});
    expect(media.downloadHeaders.Cookie).toBe("private");
    expect(loadPolicy).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith({ receivedBytes: 3, totalBytes: 3 });
  });
  it.each([401,404,429,500])("does not recover HTTP %s", async status => {
    const send = vi.fn(async () => response(status, 0)); const policy = vi.fn(recoveryPolicy);
    await expect(new ObsidianMediaDownloader(100, send, policy).download(media)).rejects.toMatchObject({ status });
    expect(send).toHaveBeenCalledTimes(1); expect(policy).not.toHaveBeenCalled();
  });
  it.each([403,502])("stops after recovery HTTP %s", async status => {
    const send = vi.fn().mockResolvedValueOnce(response(403, 0)).mockResolvedValueOnce(response(status, 0));
    await expect(new ObsidianMediaDownloader(100, send, recoveryPolicy).download(media)).rejects.toMatchObject({ name: "MediaRecoveryError", status });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each(["application/json", "text/html"])('validates recovery content (%s)', async type => {
    const send = vi.fn().mockResolvedValueOnce(response(403, 0)).mockResolvedValueOnce({ ...response(200, 3), headers: { "content-type": type } });
    await expect(new ObsidianMediaDownloader(100, send, recoveryPolicy).download(media)).rejects.toMatchObject({ name: "MediaRecoveryError" });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("keeps the mobile size limit on recovery", async () => {
    const send = vi.fn().mockResolvedValueOnce(response(403, 0)).mockResolvedValueOnce(response(200, 101));
    await expect(new ObsidianMediaDownloader(100, send, recoveryPolicy).download(media)).rejects.toMatchObject({ name: "MediaRecoveryError" });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("never nests an existing media-service URL", async () => {
    const send = vi.fn(async () => response(403, 0)); const policy = vi.fn(recoveryPolicy);
    await expect(new ObsidianMediaDownloader(100, send, policy).download({ ...media, sourceUrl: "https://m3u8.agentlensapi.io/downloader/media?url=original" }))
      .rejects.toMatchObject({ name: "MediaRecoveryError" });
    expect(send).toHaveBeenCalledTimes(1); expect(policy).not.toHaveBeenCalled();
  });
  it.each([{ hosts: ["tiktok.com"] }, { hosts: ["agentlensapi.io"] }])("requires both original and recovery domains in Obsidian's own policy", async ({ hosts }) => {
    const send = vi.fn(async () => response(403, 0));
    const policy = async () => ({ ...await recoveryPolicy(), allowedHosts: hosts });
    await expect(new ObsidianMediaDownloader(100, send, policy).download(media)).rejects.toMatchObject({ name: "MediaRecoveryError" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("cancels while policy loading and ignores its late result", async () => {
    let finish!: (value: Awaited<ReturnType<typeof recoveryPolicy>>) => void;
    const policy = vi.fn(() => new Promise<Awaited<ReturnType<typeof recoveryPolicy>>>(resolve => { finish = resolve; }));
    const send = vi.fn(async () => response(403, 0)); const controller = new AbortController();
    const work = new ObsidianMediaDownloader(100, send, policy).download(media, controller.signal);
    await vi.waitFor(() => expect(policy).toHaveBeenCalledTimes(1)); controller.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    finish(await recoveryPolicy()); await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

it("bounds a stalled policy request and never consumes late recovery authorization", async () => {
  vi.useFakeTimers();
  try {
    const send = vi.fn(async () => response(403, 0));
    const load = vi.fn(() => new Promise<Awaited<ReturnType<typeof recoveryPolicy>>>(() => {}));
    const work = new ObsidianMediaDownloader(100, send, load).download({ id: "v", kind: "video", sourceUrl: "https://www.tiktok.com/play" });
    const outcome = expect(work).rejects.toMatchObject({ name: "MediaRecoveryError" });
    await vi.advanceTimersByTimeAsync(15_000); await outcome;
    expect(send).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it("only passes a public Bilibili page referer to recovery, without its query or source headers", async () => {
  const send = vi.fn().mockResolvedValueOnce(response(403, 0)).mockResolvedValueOnce(response(200, 3));
  const load = async () => ({ ...await recoveryPolicy(), allowedHosts: ["bilivideo.com", "agentlensapi.io"] });
  await new ObsidianMediaDownloader(100, send, load).download({ id: "b", kind: "video", sourceUrl: "https://cdn.bilivideo.com/a",
    downloadHeaders: { Referer: "https://www.bilibili.com/video/BV1?token=private#fragment", Cookie: "private" } });
  const request = send.mock.calls[1]![0] as RequestUrlParam;
  expect(new URL(request.url).searchParams.get("pageUrl")).toBe("https://www.bilibili.com/video/BV1");
  expect(request.headers).toEqual({});
});
