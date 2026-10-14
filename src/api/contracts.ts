export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | undefined;
  googleAuthorizationUrl?: string | undefined;
  expiresIn: number;
  interval: number;
}

export type DevicePollResult =
  | { status: "authorization_pending"; interval?: number | undefined }
  | { status: "slow_down"; interval: number }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "authorized"; accessToken: string; expiresIn: number; refreshToken: string };

export interface AccountCapabilities {
  accountId: string;
  plan: string;
  quotaRemaining: number | null;
  minimumPluginVersion: string;
  latestPluginVersion: string;
  supportUrl: string;
  releaseNotesUrl: string;
  platforms: ReadonlyArray<{
    id: string;
    label: string;
    single: boolean;
    profile: boolean;
    autoFetch: boolean;
    profileScope: "creator" | "subreddits_only" | "none";
    mediaDownload: boolean;
    transcript: boolean;
    available: boolean;
  }>;
}

export function validateDeviceAuthorization(value: unknown): DeviceAuthorization {
  const record = requireRecord(value);
  return {
    deviceCode: requireString(record.deviceCode, "deviceCode"),
    userCode: requireString(record.userCode, "userCode"),
    verificationUri: requireVerificationUrl(record.verificationUri, "verificationUri"),
    ...(typeof record.verificationUriComplete === "string"
      ? { verificationUriComplete: requireVerificationUrl(record.verificationUriComplete, "verificationUriComplete") }
      : {}),
    ...(typeof record.googleAuthorizationUrl === "string"
      ? { googleAuthorizationUrl: requireVerificationUrl(record.googleAuthorizationUrl, "googleAuthorizationUrl") }
      : {}),
    expiresIn: requirePositiveNumber(record.expiresIn, "expiresIn"),
    interval: requirePositiveNumber(record.interval, "interval")
  };
}

export function validateAccountCapabilities(value: unknown): AccountCapabilities {
  const record = requireRecord(value);
  if (!Array.isArray(record.platforms)) throw new Error("platforms must be an array");
  const quota = record.quotaRemaining;
  if (quota !== null && (typeof quota !== "number" || quota < 0 || !Number.isFinite(quota))) {
    throw new Error("quotaRemaining must be null or a non-negative number");
  }
  return {
    accountId: requireString(record.accountId, "accountId"),
    plan: requireString(record.plan, "plan"),
    quotaRemaining: quota,
    minimumPluginVersion: requireString(record.minimumPluginVersion, "minimumPluginVersion"),
    latestPluginVersion: requireString(record.latestPluginVersion, "latestPluginVersion"),
    supportUrl: requireHttpsUrl(record.supportUrl, "supportUrl"),
    releaseNotesUrl: requireHttpsUrl(record.releaseNotesUrl, "releaseNotesUrl"),
    platforms: Object.freeze(record.platforms.map((item, index) => {
      const platform = requireRecord(item);
      return Object.freeze({
        id: requireString(platform.id, `platforms[${index}].id`),
        label: requireString(platform.label, `platforms[${index}].label`),
        single: requireBoolean(platform.single, `platforms[${index}].single`),
        profile: requireBoolean(platform.profile, `platforms[${index}].profile`),
        autoFetch: requireBoolean(platform.autoFetch, `platforms[${index}].autoFetch`),
        profileScope: requireProfileScope(platform.profileScope, `platforms[${index}].profileScope`),
        mediaDownload: requireBoolean(platform.mediaDownload, `platforms[${index}].mediaDownload`),
        transcript: requireBoolean(platform.transcript, `platforms[${index}].transcript`),
        available: requireBoolean(platform.available, `platforms[${index}].available`)
      });
    }))
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function requireHttpsUrl(value: unknown, field: string): string {
  const url = new URL(requireString(value, field));
  if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`);
  return url.toString();
}

function requireVerificationUrl(value: unknown, field: string): string {
  const url = new URL(requireString(value, field));
  const loopbackHost = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHost)) {
    throw new Error(`${field} must use HTTPS or an HTTP loopback address`);
  }
  return url.toString();
}

function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function requireProfileScope(value: unknown, field: string): "creator" | "subreddits_only" | "none" {
  if (value !== "creator" && value !== "subreddits_only" && value !== "none") {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

export interface PublicPlatformCatalog {
  clientType: string;
  platforms: ReadonlyArray<Pick<AccountCapabilities["platforms"][number], "id" | "label" | "single" | "profile" | "autoFetch" | "available">>;
}

export function validatePublicPlatformCatalog(value: unknown): PublicPlatformCatalog {
  const record = requireRecord(value);
  if (record.clientType !== "obsidian_plugin") throw new Error("Unexpected platform catalog client type");
  if (!Array.isArray(record.platforms)) throw new Error("platforms must be an array");
  return { clientType: record.clientType, platforms: Object.freeze(record.platforms.map(item => {
    const p = requireRecord(item);
    return Object.freeze({ id: requireString(p.id, "id"), label: requireString(p.label, "label"),
      single: requireBoolean(p.single, "single"), profile: requireBoolean(p.profile, "profile"),
      autoFetch: requireBoolean(p.autoFetch, "autoFetch"), available: requireBoolean(p.available, "available") });
  })) };
}
