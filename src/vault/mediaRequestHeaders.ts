import type { NormalizedMedia } from "../core/domain";

/** Bilibili's CDN requires its public origin even when the parser omits headers. */
export function mediaRequestHeaders(media: NormalizedMedia): Record<string, string> {
  const headers = { ...media.downloadHeaders };
  const url = new URL(media.sourceUrl);
  if (url.protocol === "https:" && (url.hostname === "bilivideo.com" || url.hostname.endsWith(".bilivideo.com") || url.hostname === "upos-hz-mirrorakam.akamaized.net")) {
    const supplied = new Set(Object.keys(headers).map(key => key.toLowerCase()));
    if (!supplied.has("referer")) headers.Referer = "https://www.bilibili.com/";
    if (!supplied.has("user-agent")) headers["User-Agent"] = "Mozilla/5.0";
  }
  return headers;
}
