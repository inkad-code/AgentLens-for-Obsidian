import type { NormalizedMedia } from "../core/domain";
import { MediaDownloadError, MediaRecoveryError } from "../core/mediaFailure";
import { requireRecoveryTarget, validateMediaRecoveryPolicy, type MediaRecoveryPolicy } from "../core/mediaRecoveryPolicy";

export type LoadMediaRecoveryPolicy = () => Promise<MediaRecoveryPolicy>;
export type CheckRecoveryTarget = (url: string) => void;
export const MEDIA_RECOVERY_ORIGIN = "https://m3u8.agentlensapi.io";

/** One fallback within the original download; never content parsing or URL refresh. */
export async function withMedia403Recovery<T>(media: NormalizedMedia,
  download: (candidate: NormalizedMedia, checkTarget?: CheckRecoveryTarget) => Promise<T>,
  loadPolicy: LoadMediaRecoveryPolicy | undefined, signal?: AbortSignal): Promise<T> {
  try { return await download(media); }
  catch (error) {
    if (signal?.aborted) throw new DOMException("Media download canceled.", "AbortError");
    if (!(error instanceof MediaDownloadError) || error.status !== 403) throw error;
    try {
      // Never wrap the recovery service in itself, even if the URL is malformed.
      if (new URL(media.sourceUrl).hostname === new URL(MEDIA_RECOVERY_ORIGIN).hostname || !loadPolicy) throw error;
      const policy = validateMediaRecoveryPolicy(await recoveryPolicy(loadPolicy, signal));
      if (signal?.aborted) throw new DOMException("Media download canceled.", "AbortError");
      // Desktop knows the actual forbidden CDN terminal; requestUrl exposes only the original URL.
      const source = requireRecoveryTarget(error.recoveryTarget() ?? media.sourceUrl, policy);
      const proxy = requireRecoveryTarget(`${MEDIA_RECOVERY_ORIGIN}/downloader/media`, policy);
      proxy.searchParams.set("url", source.href);
      proxy.searchParams.set("mode", "passthrough");
      const referer = Object.entries(media.downloadHeaders ?? {}).find(([key]) => key.toLowerCase() === "referer")?.[1];
      if (referer) {
        try {
          const page = new URL(referer);
          if (page.protocol === "https:" && !page.username && !page.password && !page.port
              && (page.hostname === "bilibili.com" || page.hostname.endsWith(".bilibili.com"))) {
            proxy.searchParams.set("pageUrl", page.origin + page.pathname);
          }
        } catch { /* The service supplies its default public Referer. */ }
      }
      requireRecoveryTarget(proxy.href, policy);
      // Preserve media identity and validation metadata. Source credentials never reach the service.
      return await download({ ...media, sourceUrl: proxy.href, downloadHeaders: undefined },
        target => { requireRecoveryTarget(target, policy); });
    } catch (recoveryError) {
      if (signal?.aborted) throw new DOMException("Media download canceled.", "AbortError");
      throw new MediaRecoveryError(recoveryError);
    }
  }
}

function recoveryPolicy(load: LoadMediaRecoveryPolicy, signal?: AbortSignal): Promise<MediaRecoveryPolicy> {
  return new Promise((resolve, reject) => {
    const finish = (work: () => void) => {
      window.clearTimeout(timer); signal?.removeEventListener("abort", abort); work();
    };
    const abort = () => finish(() => reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Media download canceled.", "AbortError")));
    const timer = window.setTimeout(() => finish(() => reject(new Error("Media recovery policy request timed out."))), 15_000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    Promise.resolve().then(load).then(policy => finish(() => resolve(policy)), (error: unknown) => finish(() => reject(error instanceof Error ? error : new Error("Media recovery policy request failed.", { cause: error }))));
  });
}
