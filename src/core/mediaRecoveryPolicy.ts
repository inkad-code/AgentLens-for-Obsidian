import { hasAsciiControl } from "./controlCharacters";
export interface MediaRecoveryPolicy {
  version: number;
  channel: "plugin_center";
  expiresAt: string;
  allowedHosts: readonly string[];
}

const domain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;

export function validateMediaRecoveryPolicy(value: unknown, now = Date.now()): MediaRecoveryPolicy {
  const row = value as Partial<MediaRecoveryPolicy> | null;
  if (!row || !Number.isSafeInteger(row.version) || row.version! <= 0 || row.channel !== "plugin_center"
      || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= now
      || !Array.isArray(row.allowedHosts) || !row.allowedHosts.length || row.allowedHosts.length > 512
      || row.allowedHosts.some(host => typeof host !== "string" || host.length > 253 || !domain.test(host))) {
    throw new Error("The Obsidian media recovery policy is unavailable or expired.");
  }
  return { version: row.version!, channel: row.channel, expiresAt: row.expiresAt, allowedHosts: row.allowedHosts.map((host: unknown) => {
    if (typeof host !== "string") throw new Error("Invalid recovery host.");
    return host;
  }) };
}

/** URL shape and published-domain checks; host TLS and proxy routing stay in the transport. */
export function requireRecoveryTarget(raw: string, policy: MediaRecoveryPolicy): URL {
  if (raw.length > 8192 || /[\\ ]/.test(raw) || hasAsciiControl(raw)) throw new Error("Invalid media recovery address.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid media recovery address."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !domain.test(url.hostname)
      || /\.(?:local|localhost|internal)$/.test(url.hostname)) throw new Error("Invalid media recovery address.");
  if (!policy.allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error("The media recovery address is not permitted by the Obsidian media policy.");
  }
  if (Date.parse(policy.expiresAt) <= Date.now()) throw new Error("The Obsidian media recovery policy expired.");
  url.hash = "";
  return url;
}
