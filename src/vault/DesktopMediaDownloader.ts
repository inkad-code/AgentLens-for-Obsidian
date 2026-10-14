// Desktop-only boundary: Node modules are loaded inside functions, never on mobile startup.
import type { NormalizedMedia } from "../core/domain";
import type { DownloadedMediaFile } from "./DownloadedMedia";
import { DESKTOP_MEDIA_DOWNLOAD_LIMIT } from "../core/platformPolicy";

let active = 0;
const waiters = new Set<() => void>();
async function acquire(signal?: AbortSignal): Promise<() => void> {
  while (active >= 2) {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const wake = () => { waiters.delete(wake); signal?.removeEventListener("abort", abort); resolve(); };
      const abort = () => { waiters.delete(wake); signal?.removeEventListener("abort", abort); reject(new DOMException("Download canceled", "AbortError")); };
      waiters.add(wake); signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  signal?.throwIfAborted(); active++;
  return () => { active--; for (const wake of [...waiters]) wake(); };
}

export class DesktopMediaDownloader {
  readonly refreshOnFailure = false;
  constructor(private readonly maxBytes = DESKTOP_MEDIA_DOWNLOAD_LIMIT,
    private readonly timeoutMs = 10 * 60_000, private readonly idleMs = 60_000,
    private readonly resolveProxy: (url: string) => Promise<string> = resolveDesktopProxy) {}

  async download(media: NormalizedMedia, signal?: AbortSignal): Promise<DownloadedMediaFile> {
    signal?.throwIfAborted();
    if (media.sizeBytes !== undefined && media.sizeBytes > this.maxBytes) throw new Error("Media exceeds the desktop download limit (5 GiB).");
    const release = await acquire(signal);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timers = await import("node:timers");
    const timeout = timers.setTimeout(() => controller.abort(new Error("Media download timed out.")), this.timeoutMs);
    let directory: string | undefined;
    try {
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentlens-obsidian-media-"));
      const destination = path.join(directory, "media.part");
      const response = await openMedia(media.sourceUrl, media.downloadHeaders ?? {}, controller.signal, this.idleMs, this.resolveProxy);
      const type = (response.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
      const encoding = response.headers["content-encoding"];
      const declared = response.headers["content-length"];
      const total = declared && /^\d+$/.test(declared) ? Number(declared) : undefined;
      const invalidType = /^(text\/|application\/(?:json|.*xml|.*mpegurl|vnd\.apple\.mpegurl))/.test(type)
        || media.kind === "video" && /^(image|audio)\//.test(type)
        || media.kind === "image" && /^(video|audio)\//.test(type)
        || media.kind === "audio" && /^image\//.test(type);
      if (invalidType || encoding && encoding !== "identity" || total !== undefined && total > this.maxBytes) {
        response.destroy();
        throw new Error(total !== undefined && total > this.maxBytes ? "Media exceeds the desktop download limit (5 GiB)." : "Media response is not a supported media file.");
      }
      const file = await fs.open(destination, "wx").catch(error => { response.destroy(); throw error; });
      let received = 0;
      const prefix = new Uint8Array(512); let prefixLength = 0;
      try {
        for await (const value of response) {
          controller.signal.throwIfAborted();
          const chunk = value as Uint8Array;
          received += chunk.byteLength;
          if (received > this.maxBytes) throw new Error("Media exceeds the desktop download limit (5 GiB).");
          if (prefixLength < prefix.length) {
            const part = chunk.subarray(0, prefix.length - prefixLength);
            prefix.set(part, prefixLength); prefixLength += part.length;
            const head = new TextDecoder().decode(prefix.subarray(0, prefixLength)).trimStart();
            if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b|<\?xml|<MPD\b|#EXTM3U|[[{])/i.test(head)) throw new Error("Media download returned an error document or playlist.");
          }
          let offset = 0;
          while (offset < chunk.byteLength) {
            const result = await file.write(chunk, offset, chunk.byteLength - offset);
            if (result.bytesWritten <= 0) throw new Error("Media file write failed.");
            offset += result.bytesWritten;
          }
        }
        controller.signal.throwIfAborted();
        if (!received || total !== undefined && received !== total) throw new Error("Media download is empty or incomplete.");
        await file.sync();
      } finally { response.destroy(); await file.close(); }
      const ownedDirectory = directory;
      return { kind: "file", path: destination, sizeBytes: received,
        cleanup: () => fs.rm(ownedDirectory, { recursive: true, force: true }) };
    } catch (error) {
      if (directory) {
        const fs = await import("node:fs/promises");
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (signal?.aborted) throw new DOMException("Media download canceled.", "AbortError");
      if (controller.signal.aborted) throw new Error("Media download timed out.");
      throw error;
    } finally { timers.clearTimeout(timeout); signal?.removeEventListener("abort", abort); release(); }
  }
}

async function openMedia(rawUrl: string, suppliedHeaders: Readonly<Record<string, string>>, signal: AbortSignal,
  idleMs: number, resolveProxy: (url: string) => Promise<string>, redirects = 0): Promise<import("node:http").IncomingMessage> {
  signal.throwIfAborted();
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid media URL.");
  const transport = await (url.protocol === "https:" ? import("node:https") : import("node:http"));
  const headers: Record<string, string> = { ...suppliedHeaders, "accept-encoding": "identity" };
  for (const key of Object.keys(headers)) if (/^(host|connection|content-length|transfer-encoding)$/i.test(key)) delete headers[key];
  const agent = await desktopProxyAgent(url, resolveProxy, signal);
  signal.throwIfAborted();
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const request = transport.get(url, { headers, signal, agent }, response => {
      response.once("close", () => agent?.destroy());
      resolve(response);
    });
    request.setTimeout(idleMs, () => request.destroy(new Error("Media download stalled.")));
    request.on("error", error => { agent?.destroy(); reject(error); });
  });
  if ([301,302,303,307,308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (!response.headers.location || redirects >= 5) throw new Error("Media download redirect limit exceeded.");
    const next = new URL(response.headers.location, url);
    if (url.protocol === "https:" && next.protocol !== "https:") throw new Error("Unsafe media redirect.");
    if (next.origin !== url.origin) for (const key of Object.keys(headers)) if (/^(authorization|cookie|proxy-authorization)$/i.test(key)) delete headers[key];
    return openMedia(next.href, headers, signal, idleMs, resolveProxy, redirects + 1);
  }
  if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
    response.destroy(); throw new Error(`Media download failed with HTTP ${response.statusCode}.`);
  }
  return response;
}

/** Publish without buffering, without overwriting an existing attachment, and within the bound Vault. */
export async function publishDesktopMedia(file: DownloadedMediaFile, basePath: string, relativePath: string,
  signal?: AbortSignal): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = await fs.realpath(basePath);
  const target = path.resolve(root, relativePath);
  const parent = await fs.realpath(path.dirname(target));
  if (!target.startsWith(root + path.sep) || !(parent === root || parent.startsWith(root + path.sep))) throw new Error("Attachment path is outside this Vault.");
  const staging = path.join(parent, `.agentlens-${crypto.randomUUID()}.part`);
  try {
    signal?.throwIfAborted();
    // copyFile uses bounded OS I/O, including when the temp and Vault disks differ.
    await fs.copyFile(file.path, staging, 1);
    signal?.throwIfAborted();
    if ((await fs.stat(staging)).size !== file.sizeBytes) throw new Error("Incomplete attachment copy.");
    // Hard-link creation is atomic and fails if the destination already exists.
    await fs.link(staging, target);
  } finally { await fs.unlink(staging).catch(() => undefined); }
}


/** Resolve each URL through the active Chromium session, including OS/PAC bypass rules. */
export async function resolveDesktopProxy(url: string): Promise<string> {
  const electron = await import("electron");
  const remote = electron.remote ?? await import("@electron/remote");
  const session = remote.getCurrentWebContents?.().session ?? remote.session?.defaultSession;
  if (!session?.resolveProxy) throw new Error("System proxy settings are unavailable. Restart Obsidian before retrying.");
  return session.resolveProxy(url);
}

export function systemProxyEndpoint(result: string): string | undefined {
  const first = result.split(";", 1)[0]!.trim();
  if (first === "DIRECT") return undefined;
  const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+([^\s/]+)$/i.exec(first);
  if (!match) throw new Error("Unsupported system proxy configuration.");
  const schemes: Record<string, string> = { PROXY: "http", HTTP: "http", HTTPS: "https", SOCKS: "socks4a", SOCKS4: "socks4a", SOCKS5: "socks5h" };
  const endpoint = new URL(`${schemes[match[1]!.toUpperCase()]}://${match[2]}`);
  if (!endpoint.hostname || !/:\d+$/.test(match[2]!) || endpoint.username || endpoint.password) throw new Error("Invalid system proxy address.");
  return endpoint.href;
}

async function desktopProxyAgent(url: URL, resolver: (url: string) => Promise<string>, signal: AbortSignal): Promise<import("node:http").Agent | undefined> {
  const policy = await new Promise<string>((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("Download canceled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void Promise.resolve().then(() => resolver(url.href)).then(resolve, error => reject(error instanceof Error ? error : new Error("Proxy resolution failed."))).finally(() => signal.removeEventListener("abort", abort));
  });
  signal.throwIfAborted();
  const endpoint = systemProxyEndpoint(policy);
  // A configured proxy failure must never silently fall back to direct traffic.
  if (!endpoint) return undefined;
  if (endpoint.startsWith("socks")) {
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    return new SocksProxyAgent(endpoint);
  }
  if (url.protocol === "https:") {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    return new HttpsProxyAgent(endpoint);
  }
  const { HttpProxyAgent } = await import("http-proxy-agent");
  return new HttpProxyAgent(endpoint);
}
