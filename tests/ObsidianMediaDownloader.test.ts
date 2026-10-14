import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
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
