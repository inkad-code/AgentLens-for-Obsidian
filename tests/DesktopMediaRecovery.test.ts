// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DesktopMediaDownloader } from "../src/vault/DesktopMediaDownloader";

const network = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("node:https", () => ({ get: network.get }));
type Reply = { status: number; headers?: Record<string, string>; bytes?: Uint8Array };
const replies: Reply[] = [];
const requests: Array<{ url: string; headers: Record<string, string> }> = [];
const bytes = new Uint8Array(4096).fill(42);
const media = { id: "original", kind: "video" as const, sourceUrl: "https://www.tiktok.com/aweme/v1/play/?video_id=original",
  downloadHeaders: { Cookie: "source-private", Authorization: "Bearer source", Referer: "https://www.tiktok.com/" } };
const loadPolicy = async () => ({ version: 1, channel: "plugin_center" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(), allowedHosts: ["tiktok.com", "tiktokcdn.com", "agentlensapi.io"] });
beforeEach(() => {
  replies.length = 0; requests.length = 0;
  network.get.mockReset().mockImplementation((url: URL, options: { headers: Record<string, string> }, ready: (stream: IncomingMessage) => void) => {
    requests.push({ url: url.href, headers: { ...options.headers } });
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected media request");
    const stream = Object.assign(Readable.from(reply.bytes ? [reply.bytes] : []), {
      statusCode: reply.status, headers: { "content-type": "video/mp4", ...reply.headers }
    });
    const request = Object.assign(new EventEmitter(), { setTimeout: vi.fn() });
    queueMicrotask(() => ready(stream as unknown as IncomingMessage));
    return request;
  });
});

it("streams CDN403 recovery to a complete hashed file using the original transfer and system routes", async () => {
  replies.push({ status: 302, headers: { location: "https://v16.tiktokcdn.com/video" } }, { status: 403 },
    { status: 200, headers: { "content-length": "4096" }, bytes });
  const route = vi.fn(async (_url: string) => "DIRECT"); const progress = vi.fn();
  const file = await new DesktopMediaDownloader(undefined, undefined, undefined, route, loadPolicy).download(media, undefined, progress);
  try {
    expect(new Uint8Array(await readFile(file.path))).toEqual(bytes);
    expect(file.sizeBytes).toBe(4096);
    expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(requests).toHaveLength(3);
    const recovery = new URL(requests[2]!.url);
    expect(recovery.origin + recovery.pathname).toBe("https://m3u8.agentlensapi.io/downloader/media");
    expect(recovery.searchParams.get("url")).toBe("https://v16.tiktokcdn.com/video");
    expect(recovery.searchParams.get("mode")).toBe("passthrough");
    expect(requests[2]!.headers).toEqual({ "accept-encoding": "identity" });
    expect(route.mock.calls.map(c => c[0])).toEqual(requests.map(r => r.url));
    expect(progress).toHaveBeenLastCalledWith({ receivedBytes: 4096, totalBytes: 4096 });
  } finally { await file.cleanup(); }
  await expect(readFile(file.path)).rejects.toThrow();
});

it.each([403,502])("does not nest or repeat failed recovery HTTP%s", async status => {
  replies.push({ status: 403 }, { status });
  await expect(new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT", loadPolicy).download(media))
    .rejects.toMatchObject({ name: "MediaRecoveryError", status });
  expect(requests).toHaveLength(2);
});

it.each([
  { "content-type": "text/html" }, { "content-length": "5000" }, { "content-length": "2" }
])("retains content, truncation and size checks on the recovered stream (%j)", async headers => {
  replies.push({ status: 403 }, { status: 200, headers, bytes });
  await expect(new DesktopMediaDownloader(4096, undefined, undefined, async () => "DIRECT", loadPolicy).download(media))
    .rejects.toMatchObject({ name: "MediaRecoveryError" });
  expect(requests).toHaveLength(2);
});

it("rejects an unapproved recovery redirect before another connection", async () => {
  replies.push({ status: 403 }, { status: 302, headers: { location: "https://unapproved.example/video" } });
  await expect(new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT", loadPolicy).download(media))
    .rejects.toMatchObject({ name: "MediaRecoveryError" });
  expect(requests).toHaveLength(2);
});

it("does not recover a system proxy resolution error", async () => {
  const policy = vi.fn(loadPolicy);
  await expect(new DesktopMediaDownloader(undefined, undefined, undefined, async () => { throw new Error("Configured proxy unavailable"); }, policy).download(media))
    .rejects.toThrow("Configured proxy unavailable");
  expect(policy).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
});

it("recovers only the approved actual CDN terminal rather than forwarding a disallowed redirect entry", async () => {
  replies.push({ status: 302, headers: { location: "https://v16.tiktokcdn.com/video?signed=private" } }, { status: 403 },
    { status: 200, bytes });
  const policy = async () => ({ ...await loadPolicy(), allowedHosts: ["tiktokcdn.com", "agentlensapi.io"] });
  const file = await new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT", policy).download(media);
  try {
    expect(new URL(requests[2]!.url).searchParams.get("url")).toBe("https://v16.tiktokcdn.com/video?signed=private");
    expect(file.sizeBytes).toBe(4096);
  } finally { await file.cleanup(); }
});

it("does not leak a signed failure target into serialized error evidence", async () => {
  const { MediaDownloadError } = await import("../src/core/mediaFailure");
  const error = MediaDownloadError.http(403, "https://v16.tiktokcdn.com/video?secret=signed");
  expect(error.recoveryTarget()).toContain("secret=signed");
  expect(JSON.stringify(error)).not.toContain("secret");
});
