import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import type { NormalizedMedia } from "../core/domain";

type RequestUrlFn = (request: RequestUrlParam | string) => Promise<RequestUrlResponse>;

export class ObsidianMediaDownloader {
  constructor(
    private readonly maxBytes: number,
    private readonly send: RequestUrlFn = requestUrl
) {}

  async download(media: NormalizedMedia, signal?: AbortSignal): Promise<ArrayBuffer> {
    signal?.throwIfAborted();
    if (media.sizeBytes !== undefined && media.sizeBytes > this.maxBytes) {
      throw new Error(`Media exceeds the ${this.maxBytes} byte download limit.`);
    }
    const response = await abortable(this.send({
      url: media.sourceUrl,
      method: "GET",
      headers: { ...(media.downloadHeaders ?? {}) },
      throw: false
    }), signal, 120_000);
    signal?.throwIfAborted();
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Media download failed with HTTP ${response.status}.`);
    }
    if (response.arrayBuffer.byteLength > this.maxBytes) {
      throw new Error(`Media exceeds the ${this.maxBytes} byte download limit.`);
    }
    validateMediaResponse(response, media);
    return response.arrayBuffer;
  }
}


// requestUrl returns the decoded response body; compressed Content-Length is
// therefore not comparable to the returned byte count.
function validateMediaResponse(response: RequestUrlResponse, media: NormalizedMedia): void {
  const bytes = response.arrayBuffer;
  if (bytes.byteLength === 0) throw new Error("Media download returned empty content.");
  const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
  const contentType = (headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (["text/html", "text/xml", "application/xml", "application/dash+xml", "application/xhtml+xml", "application/json", "application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl"].includes(contentType)) {
    throw new Error("Media download returned an error document or an unsupported playlist.");
  }
  const prefix = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b|<\?xml\b|<MPD\b|#EXTM3U\b|[[{])/i.test(prefix)) {
    throw new Error("Media download returned an error document or an unsupported playlist.");
  }
  if ((media.kind === "video" && /^(?:image|audio)\//.test(contentType))
      || (media.kind === "image" && /^(?:video|audio)\//.test(contentType))
      || (media.kind === "audio" && /^image\//.test(contentType))) {
    throw new Error("Media download returned a different media type. Please fetch the post again.");
  }
  const length = headers["content-length"];
  const encoding = headers["content-encoding"]?.toLowerCase();
  if (length && /^\d+$/.test(length) && (!encoding || encoding === "identity") && Number(length) !== bytes.byteLength) {
    throw new Error("Media download is incomplete: Content-Length does not match the received bytes.");
  }
}

// Obsidian requestUrl has no abort API. Stop awaiting it and never consume late bytes.
function abortable<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Download cancelled", "AbortError")));
    const timer = timeoutMs === undefined ? undefined : window.setTimeout(() => finish(() => reject(new Error("Media download timed out. Please retry the failed attachment."))), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error instanceof Error ? error : new Error("Media download failed."))));
  });
}
