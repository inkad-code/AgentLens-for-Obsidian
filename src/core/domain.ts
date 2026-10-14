export type MediaPolicy = "download_all" | "download_images_only" | "link_only";

export interface NormalizedAuthor {
  id: string;
  displayName: string;
  handle?: string | undefined;
  profileUrl?: string | undefined;
}

export interface NormalizedMedia {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  sourceUrl: string;
  filename?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
  extension?: string | undefined;
  downloadHeaders?: Readonly<Record<string, string>> | undefined;
  downloadUrlExpiresAt?: string | undefined;
  thumbnailUrl?: string | undefined;
  coverUrl?: string | undefined;
  thumbnailExpiresAt?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  durationSeconds?: number | undefined;
  tags?: readonly string[] | undefined;
}

export interface NormalizedPost {
  platform: string;
  contentId: string;
  canonicalUrl: string;
  title?: string | undefined;
  text: string;
  summary?: string | undefined;
  body?: string | undefined;
  transcript?: string | undefined;
  /** Listing cover, kept independently from full article media. */
  thumbnailUrl?: string | undefined;
  publishedAt?: string | undefined;
  author: NormalizedAuthor;
  media: readonly NormalizedMedia[];
}

/** Human-facing label; stable IDs belong in identity fields, not card headings. */
export function postDisplayTitle(post: NormalizedPost): string {
  return validPostTitle(post) || `Post from ${creatorDisplayName(post.author)}`;
}

export function postListTitle(post: NormalizedPost): string {
  return validPostTitle(post)
    || post.text.split(/\r?\n/).map(cleanPostTitle).find(line => line && line !== post.contentId)
    || `Post from ${creatorDisplayName(post.author)}`;
}

function validPostTitle(post: NormalizedPost): string {
  const title = cleanPostTitle(post.title ?? "");
  return title === post.contentId || /^(?:[a-f0-9]{24,}|gh_[a-f0-9]+)$/i.test(title) ? "" : title;
}

export function postThumbnailUrl(post: NormalizedPost): string | undefined {
  const media = post.media[0];
  return post.thumbnailUrl || media?.thumbnailUrl || media?.coverUrl
    || (media?.kind === "image" ? media.sourceUrl : undefined);
}

/** Provider titles are plain text for every platform and workflow. */
export function cleanPostTitle(title: string): string {
  const named: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " "
  };
  let result = cleanPostText(title);
  for (let pass = 0; pass < 2; pass += 1) {
    const decoded = result.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#(?:x[0-9a-f]+|\d+));/gi, entity => {
      const value = named[entity.toLowerCase()];
      if (value !== undefined) return value;
      const codepoint = entity[2]?.toLowerCase() === "x"
        ? Number.parseInt(entity.slice(3, -1), 16)
        : Number.parseInt(entity.slice(2, -1), 10);
      return codepoint > 31 && codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff)
        ? String.fromCodePoint(codepoint) : " ";
    });
    if (decoded === result) break;
    result = decoded;
  }
  return result
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/\s+/g, " ").trim();
}

export function contentKey(post: Pick<NormalizedPost, "platform" | "contentId">): string {
  const platform = post.platform.trim().toLowerCase();
  const contentId = post.contentId.trim();
  if (!platform || !contentId) throw new Error("Stable content identity requires a platform and content ID.");
  return `${platform}:${contentId}`;
}

export function mediaKey(
  post: Pick<NormalizedPost, "platform" | "contentId">,
  media: Pick<NormalizedMedia, "id">
): string {
  const id = media.id.trim();
  if (!id) throw new Error("Stable media identity requires a media ID.");
  return `${contentKey(post)}:media:${id}`;
}

export interface PersistedLedgerEntry {
  destination: "obsidian";
  contentKey: string;
  contentId: string;
  fetchId?: string | undefined;
  effectivePostKey: string;
  notePath: string;
  attachmentPaths: readonly string[];
  media: ReadonlyArray<{ mediaKey: string; path: string; status: "saved" | "skipped" | "linked" | "failed" }>;
  monitoringInstanceId?: string | undefined;
  sourceUrl: string;
  mediaPolicy: MediaPolicy;
  writtenAt: string;
  firstWrittenAt: string;
  lastVerifiedAt: string;
  physicalStatus: "active" | "partial" | "missing";
  lastActionId: string;
  managedDigest: string;
  status: "written" | "updated" | "failed" | "skipped_duplicate";
  completion: "complete" | "partial";
  error?: string | undefined;
}

export interface PendingAction {
  id: string;
  kind: "write_manifest" | "result_callback" | "media_retry" | "remote_action" | "scheduler_checkpoint";
  createdAt: string;
  payload: unknown;
}

/** Remove provider markup, preserving the original hashtag text. */
export function cleanPostText(text: string): string {
  return text.replace(/\[(?:话题|話題)#?\]#?/g, " ").replace(/【(?:话题|話題)#?】#?/g, " ").replace(/[\u200b\ufeff]/g, "").replace(/＃(?=[\p{L}\p{N}_])/gu, "#");
}

/** Source hashtags belong in the note body; platform and creator belong in frontmatter. */
export function postContentTags(post: NormalizedPost): string[] {
  const content = cleanPostText(post.body?.trim() || post.text.trim() || post.summary?.trim() || "");
  const sourceTags = [...content.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(match => match[1]!);
  const generatedTags = new Set([post.platform, creatorDisplayName(post.author)]
    .map(value => value.trim().replace(/^#/, "").toLocaleLowerCase()));
  const mediaTags = post.media.flatMap(item => item.tags ?? [])
    .map(tag => cleanPostText(tag).replace(/^#/, "").trim())
    .filter(tag => tag && !generatedTags.has(tag.toLocaleLowerCase()));
  return [...new Set([...sourceTags, ...mediaTags])];
}

export function creatorDisplayName(author: NormalizedAuthor): string {
  return author.displayName?.trim() || author.handle?.trim().replace(/^@/, "") || author.id;
}
