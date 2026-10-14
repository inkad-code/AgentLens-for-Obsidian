const SENSITIVE_QUERY_KEYS = [
  "token", "access_token", "auth", "authorization", "signature", "sig", "key", "api_key",
  "policy", "credential", "x-amz-signature", "x-amz-credential", "x-amz-security-token",
  "x-goog-signature", "x-goog-credential"
];

const FIRST_PUBLIC_LINK = /https?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION = /[，。、；：！？）】》”’)\]}>]+$/;

/**
 * Social apps copy a caption together with the link, so users paste a whole share
 * sentence instead of a bare URL. Pull the first link out of it and leave anything
 * that already looks like a plain URL untouched.
 */
export function publicLinkFromText(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(FIRST_PUBLIC_LINK);
  if (!match) return trimmed;
  const link = match[0].replace(TRAILING_PUNCTUATION, "") || trimmed;
  return link;
}

export function redactPersistentUrl(rawUrl: string, expiresAt?: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    if (expiresAt) {
      url.search = "";
      return url.toString();
    }
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`))) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}
