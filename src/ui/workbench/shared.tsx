import { singleAuthorInstagram } from "./singleControlAssets";
import { creatorInstagram } from "./creatorAssets";
import { platformAssets } from "./platformAssets";
import { designAssets } from "./designAssets";
import { RemoteImage } from "./RemoteImage";
import defaultMediaCover from "./assets/media-cover-placeholder.svg";
import type { NormalizedPost } from "../../core/domain";
import type { AccountCapabilities, PublicPlatformCatalog } from "../../api/contracts";
import { userMessage } from "../../core/user-feedback";
import { versionAtLeast } from "../../core/versions";

export function SupportedPlatforms({ capabilities, publicCatalog, catalogError = false, mode }: {
  capabilities: AccountCapabilities | null;
  publicCatalog?: PublicPlatformCatalog | null;
  catalogError?: boolean;
  mode: "single" | "profile" | "autoFetch";
}) {
  // Both catalogs are ordered by the platform. Filtering must preserve that order.
  const catalog = capabilities ?? publicCatalog;
  const platforms = catalog?.platforms.filter(platform => platform.available && platform[mode] && Object.prototype.hasOwnProperty.call(platformAssets, platform.id)) ?? [];
  return (
    <div className="agentlens-platforms" aria-live="polite" aria-label={`${mode === "single" ? "Single Fetch" : mode === "profile" ? "Bulk Fetch" : "Auto-Fetch"} supported platforms`}>
      <span className="agentlens-platforms-label">Supports</span>
      {!catalog ? <span>{catalogError ? "Platform list unavailable" : "Loading supported platforms…"}</span> : platforms.length > 0
        ? platforms.map(platform => {
          const scope = "profileScope" in platform && platform.profileScope === "subreddits_only";
          return <span key={platform.id} className={platform.available ? undefined : "is-unavailable"}
            aria-label={scope ? `${platform.label}: subreddit links only` : `${platform.label}${platform.available ? "" : " · plan upgrade"}`}>
            <PlatformIcon id={platform.id} /><span className="agentlens-sr-only">{platform.label}{scope && mode !== "single" ? " · subreddits only" : ""}{platform.available ? "" : " · plan upgrade"}</span>
          </span>;
        }) : <span>No supported platforms are available for this account.</span>}
      {catalog && catalogError && <p role="status">Platform list could not be refreshed. Showing last available platforms.</p>}
    </div>
  );
}

export function PlatformIcon({ id, variant = "badge" }: { id: string; variant?: "badge" | "glyph" | "creator" | "author" }) {
  const asset = (platformAssets as Readonly<Record<string,string>>)[id];
  const glyphs: Readonly<Record<string,string>> = {instagram: designAssets.imgGroup1, facebook: designAssets.imgGroup9, bluesky: designAssets.imgGroup12};
  const inline = variant !== "badge";
  const glyph = variant === "author" && id === "instagram" ? singleAuthorInstagram : variant === "creator" && id === "instagram" ? creatorInstagram : inline ? glyphs[id] : undefined;
  return asset ? <i className={`agentlens-platform-icon${inline ? " is-inline-glyph" : ""}${inline && !glyph ? " is-cropped-badge" : ""}`} aria-hidden="true"><img src={glyph ?? (inline ? croppedPlatformAsset(asset, id) : asset)} alt="" width="36" height="36" /></i>
    : <i className="agentlens-platform-mark" data-platform={id} aria-hidden="true">{platformMark(id)}</i>;
}


function croppedPlatformAsset(asset: string, id: string): string {
  const prefix = "data:image/svg+xml;charset=utf-8,";
  if (!asset.startsWith(prefix)) return asset;
  return prefix + encodeURIComponent(decodeURIComponent(asset.slice(prefix.length)).replace('viewBox="0 0 36 36"', id === "zhihu" ? 'viewBox="5 5 26 26"' : 'viewBox="8 8 20 20"'));
}

export function EvidenceStep({ label, state }: { label: string; state?: "current" }) {
  return (
    <div className={`agentlens-evidence-step${state ? " is-current" : ""}`}>
      <span aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  );
}

export function RemoteThumbnail({ url, kind, postCover = kind !== "Creator" }: { url?: string | undefined; kind: string; postCover?: boolean }) {
  const placeholder = postCover ? <img className="agentlens-default-media-cover" src={defaultMediaCover} alt="" /> : kind;
  if (!url) return <span className="agentlens-media-placeholder" aria-label={kind === "Text only" ? "Text-only post" : "Thumbnail unavailable"}>{placeholder}</span>;
  return <RemoteImage url={url} className="agentlens-media-thumb" alt="Remote source thumbnail" placeholder={placeholder} />;
}

export function message(error: unknown, context: "action" | "read_only" | "auth" = "action"): string {
  return userMessage(error, context);
}

export function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function billingAction(reason: string | null): string {
  if (reason === "SUBSCRIPTION_EXPIRED") return "Renew";
  if (reason === "QUOTA_EXHAUSTED" || reason === "QUOTA_EXCEEDED") return "Buy add-on pack";
  return "Upgrade";
}

function platformMark(platformId: string): string {
  const marks: Readonly<Record<string, string>> = {
    tiktok: "TT", instagram: "IG", youtube: "YT", x: "X", facebook: "FB", threads: "TH",
    reddit: "R", linkedin: "IN", twitch: "TW", pinterest: "P", bluesky: "BS", vimeo: "V",
    snapchat: "SC", kick: "K", lemon8: "L8", douyin: "DY", xiaohongshu: "XHS", weibo: "WB",
    bilibili: "B", kuaishou: "KS", xigua: "XG", zhihu: "ZH", wechat_official_account: "WA",
    wechat_channels: "WC"
  };
  return marks[platformId] ?? platformId.slice(0, 2).toUpperCase();
}

export function mediaCounts(post: NormalizedPost): { images: number; videos: number; audio: number } {
  return {
    images: post.media.filter((media) => media.kind === "image").length,
    videos: post.media.filter((media) => media.kind === "video").length,
    audio: post.media.filter((media) => media.kind === "audio").length
  };
}

export function formatBytes(value?: number): string {
  if (value === undefined) return "size unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function operationAvailable(capabilities: AccountCapabilities | null, operation: "single" | "profile" | "autoFetch", currentVersion?: string): boolean {
  return Boolean(capabilities
    && (!currentVersion || versionAtLeast(currentVersion, capabilities.minimumPluginVersion))
    && capabilities.platforms.some((platform) => platform[operation] && platform.available));
}
