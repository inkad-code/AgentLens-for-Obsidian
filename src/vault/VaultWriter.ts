import type { DownloadedMedia, DownloadedMediaFile } from "./DownloadedMedia";
import type { MediaPolicy, NormalizedMedia, NormalizedPost, PersistedLedgerEntry } from "../core/domain";
import { contentKey, mediaKey, cleanPostText, cleanPostTitle, creatorDisplayName, postContentTags, postDisplayTitle } from "../core/domain";
import { AgentLensError } from "../core/errors";
import { normalizeVaultRelativePath } from "../core/vaultPaths";
import { postBodyMarkdown } from "../core/postBodyMarkdown";

export { normalizeVaultRelativePath } from "../core/vaultPaths";
import { redactPersistentUrl } from "../core/urls";

const MANAGED_START = "<!-- agentlens:start -->";
const MANAGED_END = "<!-- agentlens:end -->";
const LEGACY_MANAGED_START = "<!-- agentlens:managed:start -->";
const LEGACY_MANAGED_END = "<!-- agentlens:managed:end -->";

export interface VaultFileRef {
  path: string;
}

export interface VaultPort {
  getFile(path: string): VaultFileRef | null;
  readText(file: VaultFileRef): Promise<string>;
  createText(path: string, content: string): Promise<VaultFileRef>;
  modifyText(file: VaultFileRef, content: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
  updateFrontmatter(file: VaultFileRef, values: Readonly<Record<string, unknown>>): Promise<void>;
  createBinary(path: string, data: ArrayBuffer): Promise<VaultFileRef>;
  importMediaFile?(path: string, file: DownloadedMediaFile, signal?: AbortSignal): Promise<VaultFileRef>;
  findByAgentLensKey?(folderPath: string, contentKey: string, sourceUrl: string): Promise<VaultFileRef | null>;
  matchesAgentLensKey?(file: VaultFileRef, contentKey: string, sourceUrl: string): Promise<boolean>;
  recordNoteIdentity?(file: VaultFileRef, contentKey: string): Promise<void>;
}

export type NoteWriteAction = "new" | "update" | "skip" | "blocked";

export interface NoteWriteManifest {
  readonly contentKey: string;
  readonly fetchId?: string | undefined;
  readonly notePath: string;
  readonly action: NoteWriteAction;
  readonly saveAsCopy?: boolean | undefined;
  /** Existing content in this destination, independent of saving another copy. */
  readonly alreadySaved?: boolean | undefined;
  readonly reason: string;
  readonly managedDigest: string;
  readonly mediaPolicy: MediaPolicy;
  readonly templateId: "default" | "compact";
  readonly expectedOutcome: "complete" | "partial";
  readonly partialReasons: readonly string[];
  readonly renderedManagedBlock: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly attachments: readonly AttachmentWriteManifest[];
}

export interface AttachmentWriteManifest {
  readonly mediaId: string;
  readonly path: string;
  readonly sourceUrl: string;
  readonly action: "new" | "skip" | "link";
  readonly partialReason?: string | undefined;
}

export interface VaultWriteResult {
  manifest: NoteWriteManifest;
  file: VaultFileRef;
  ledger: PersistedLedgerEntry;
  attachments: ReadonlyArray<{ mediaId: string; path: string; status: "saved" | "skipped" | "linked" | "failed"; error?: string | undefined }>;
}

type AttachmentWriteResult = VaultWriteResult["attachments"][number];

export interface VaultWriterOptions {
  folderPath: string;
  now?: (() => Date) | undefined;
  mediaPolicy?: MediaPolicy | undefined;
  templateId?: "default" | "compact" | undefined;
  addPlatformTag?: boolean | undefined;
  addCreatorTag?: boolean | undefined;
  addMediaTags?: boolean | undefined;
  maxDownloadBytes?: number | undefined;
}

export interface NotePlanContext {
  fetchId?: string | undefined;
  fetchedAt?: string | undefined;
  existingMediaPaths?: Readonly<Record<string, string>> | undefined;
  existingMediaNotePath?: string | undefined;
  saveAsCopy?: boolean | undefined;
  targetNotePath?: string | undefined;
}

export interface VaultWriteContext {
  signal?: AbortSignal | undefined;
  actionId?: string | undefined;
  monitoringInstanceId?: string | undefined;
  firstWrittenAt?: string | undefined;
}

export class VaultWriter {
  private readonly now: () => Date;

  constructor(private readonly vault: VaultPort, private readonly options: VaultWriterOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async plan(post: NormalizedPost, context: NotePlanContext = {}): Promise<NoteWriteManifest> {
    const folderPath = normalizeVaultRelativePath(this.options.folderPath);
    const key = contentKey(post);
    assertUniqueMediaIdentities(post);
    const fetchedAt = context.fetchedAt ?? this.now().toISOString();
    const targetNotePath = context.targetNotePath && normalizeVaultRelativePath(context.targetNotePath);
    if (targetNotePath && (!targetNotePath.startsWith(`${folderPath}/`) || !targetNotePath.endsWith(".md"))) {
      throw new AgentLensError("vault_conflict", "The recovery note path is outside the destination folder.", false);
    }
    const knownFile = targetNotePath ? null : await this.vault.findByAgentLensKey?.(folderPath, key, post.canonicalUrl) ?? null;
    const notePath = targetNotePath ?? (!context.saveAsCopy ? knownFile?.path : null) ?? await availableNotePath(
      this.vault,
      `${folderPath}/${noteFilename(post, fetchedAt)}`, key, post.canonicalUrl,
      !context.saveAsCopy, Boolean(context.saveAsCopy && knownFile)
);
    const attachments = Object.freeze(planAttachments(
      this.vault,
      post,
      notePath,
      this.options.mediaPolicy ?? "download_all",
      this.options.maxDownloadBytes,
      this.now(),
      !context.existingMediaNotePath || context.existingMediaNotePath === notePath ? context.existingMediaPaths : undefined
));
    const partialReasons = Object.freeze(attachments.flatMap((attachment) => attachment.partialReason ? [attachment.partialReason] : []));
    const renderedManagedBlock = renderManagedBlock(post, attachments);
    const managedDigest = stableDigest(renderedManagedBlock);
    const frontmatter = buildFrontmatter(post, fetchedAt, this.options);

    const existing = this.vault.getFile(notePath);
    const common = {
      key, fetchId: context.fetchId, notePath, saveAsCopy: context.saveAsCopy, alreadySaved: Boolean(knownFile), managedDigest, renderedManagedBlock, frontmatter, attachments,
      expectedOutcome: partialReasons.length > 0 ? "partial" as const : "complete" as const,
      partialReasons,
      mediaPolicy: this.options.mediaPolicy ?? "download_all" as const,
      templateId: "default" as const
    };
    if (!existing) return freezeManifest({ ...common, action: "new", reason: "New note" });

    const current = await this.vault.readText(existing);
    const oldManaged = extractManagedBlock(current);
    if (!oldManaged) {
      return freezeManifest({ ...common, action: "blocked", reason: "Existing note is not managed by AgentLens" });
    }
    // A host exit can leave the initial note before identity metadata is written.
    // Compare the exact planned content, restoring only this manifest's markers.
    const recoverableManaged = attachments.reduce((text, item) =>
      text.replaceAll(downloadingPlaceholder(item.mediaId), `![[${item.path}]]`), managedContent(oldManaged));
    if (targetNotePath && !(this.vault.matchesAgentLensKey
      ? await this.vault.matchesAgentLensKey(existing, key, post.canonicalUrl)
      : current.includes(`<!-- agentlens:identity:${encodeURIComponent(key)} -->`))
      && recoverableManaged !== renderedManagedBlock) {
      return freezeManifest({ ...common, action: "blocked", reason: "The recovery note path belongs to another note" });
    }
    if (managedContent(oldManaged) === renderedManagedBlock && !oldManaged.includes("<!-- agentlens:")) {
      return freezeManifest({ ...common, action: "skip", reason: "Managed content is unchanged" });
    }
    return freezeManifest({ ...common, action: "update", reason: "Managed content changed" });
  }

  async resolveNewCollision(post: NormalizedPost, manifest: NoteWriteManifest): Promise<NoteWriteManifest> {
    if (manifest.action !== "new" || !this.vault.getFile(manifest.notePath)) return manifest;
    return new VaultWriter(this.vault, { ...this.options, folderPath: manifest.notePath.slice(0, manifest.notePath.lastIndexOf("/")), templateId: manifest.templateId, mediaPolicy: manifest.mediaPolicy }).plan(post, { fetchId: manifest.fetchId, saveAsCopy: manifest.saveAsCopy });
  }

  async execute(
    manifest: NoteWriteManifest,
    sourceUrl: string,
    resolveMedia?: ((mediaId: string) => Promise<DownloadedMedia>),
    context: VaultWriteContext = {}
): Promise<VaultWriteResult> {
    if (manifest.action === "blocked") {
      throw new AgentLensError("vault_conflict", manifest.reason, false);
    }

    context.signal?.throwIfAborted();
    const pendingBlock = resolveMedia ? manifest.attachments
      .filter(item => item.action === "new")
      .reduce((text, item) => text.replaceAll(`![[${item.path}]]`, downloadingPlaceholder(item.mediaId)), manifest.renderedManagedBlock)
      : manifest.renderedManagedBlock;
    const file = await this.writeNote({ ...manifest, renderedManagedBlock: pendingBlock });
    const attachmentResults = await this.writeAttachments(file, manifest, sourceUrl, resolveMedia, context.signal);
    return writeResult(manifest, file, attachmentResults, sourceUrl, context, this.now().toISOString());
  }

  private async writeNote(manifest: NoteWriteManifest): Promise<VaultFileRef> {
    const folder = manifest.notePath.slice(0, manifest.notePath.lastIndexOf("/"));
    await this.vault.ensureFolder(folder);
    let file = this.vault.getFile(manifest.notePath);
    if (manifest.action === "new") {
      if (file) throw new AgentLensError("vault_conflict", "The planned note path became occupied.", true);
      file = await this.vault.createText(manifest.notePath, `${manifest.renderedManagedBlock}\n\n## Note\n\n`);
    } else if (!file) {
      throw new AgentLensError("vault_conflict", "The planned note disappeared before it was written.", true);
    } else if (manifest.action === "update") {
      const current = await this.vault.readText(file);
      const updated = replaceManagedBlock(current, manifest.renderedManagedBlock);
      await this.vault.modifyText(file, updated);
    }

    await this.vault.updateFrontmatter(file, manifest.frontmatter);
    await this.vault.recordNoteIdentity?.(file, manifest.contentKey);
    return file;
  }

  private async writeAttachments(
    file: VaultFileRef,
    manifest: NoteWriteManifest,
    sourceUrl: string,
    resolveMedia?: ((mediaId: string) => Promise<DownloadedMedia>),
    signal?: AbortSignal
): Promise<AttachmentWriteResult[]> {
    const attachmentResults: AttachmentWriteResult[] = [];
    for (const attachment of manifest.attachments) {
      if (attachment.action === "skip") {
        attachmentResults.push({ mediaId: attachment.mediaId, path: attachment.path, status: "skipped" });
        continue;
      }
      if (attachment.action === "link" || !resolveMedia) {
        attachmentResults.push({ mediaId: attachment.mediaId, path: attachment.path, status: attachment.action === "link" ? "linked" : "failed" });
        continue;
      }
      try {
        const attachmentFolder = attachment.path.slice(0, attachment.path.lastIndexOf("/"));
        signal?.throwIfAborted();
        await this.vault.ensureFolder(attachmentFolder);
        const bytes = await resolveMedia(attachment.mediaId);
        try {
          signal?.throwIfAborted();
          if ("kind" in bytes) {
            if (!this.vault.importMediaFile) throw new Error("This Vault cannot import desktop media files.");
            await this.vault.importMediaFile(attachment.path, bytes, signal);
          } else {
            await this.vault.createBinary(attachment.path, bytes);
          }
        } finally {
          if ("kind" in bytes) await bytes.cleanup();
        }
        attachmentResults.push({ mediaId: attachment.mediaId, path: attachment.path, status: "saved" });
      } catch (error) {
        attachmentResults.push({ mediaId: attachment.mediaId, path: attachment.path, status: "failed",
          error: error instanceof Error ? error.message : "The attachment could not be saved." });
      }
    }
    if (attachmentResults.some(item => item.status === "failed" || item.status === "saved")) {
      const current = await this.vault.readText(file);
      const managed = extractManagedBlock(current);
      if (managed) {
        const repaired = attachmentResults.reduce((text, item) => {
          const embed = `![[${item.path}]]`;
          const replacement = item.status === "failed" ? "Media not saved" : embed;
          const completed = text.replaceAll(downloadingPlaceholder(item.mediaId), replacement);
          return item.status === "failed" ? completed.replaceAll(embed, replacement) : completed;
        }, managed);
        if (repaired !== managed) await this.vault.modifyText(file, replaceManagedBlock(current, repaired));
      }
    }
    return attachmentResults;
  }
}

function downloadingPlaceholder(mediaId: string): string {
  return `<!-- agentlens:downloading:${encodeURIComponent(mediaId)} -->Downloading…`;
}

function assertUniqueMediaIdentities(post: NormalizedPost): void {
  const mediaKeys = new Set<string>();
  for (const media of post.media) {
    const key = mediaKey(post, media);
    if (mediaKeys.has(key)) {
      throw new AgentLensError("vault_conflict", "Stable media identities must be unique within a post.", false);
    }
    mediaKeys.add(key);
  }
}

function buildFrontmatter(
  post: NormalizedPost,
  fetchedAt: string,
  options: VaultWriterOptions
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    Platform: post.platform,
    Creator_name: post.author.displayName,
    Creator_url: post.author.profileUrl ?? null,
    Source_url: post.canonicalUrl,
    Published_at: post.publishedAt ?? null,
    Fetched_at: fetchedAt,
    Media_count: post.media.length,
    Media_policy: options.mediaPolicy ?? "download_all",
    tags: Object.freeze(noteTags(post, options))
  });
}

function writeResult(
  manifest: NoteWriteManifest,
  file: VaultFileRef,
  attachmentResults: AttachmentWriteResult[],
  sourceUrl: string,
  context: VaultWriteContext,
  writtenAt: string
): VaultWriteResult {
  const partial = attachmentResults.some((item) => item.status === "failed"
    || item.status === "linked" && Boolean(manifest.attachments.find((attachment) => attachment.mediaId === item.mediaId)?.partialReason));
  return {
    manifest,
    file,
    ledger: {
      destination: "obsidian",
      contentKey: manifest.contentKey,
      contentId: manifest.contentKey.slice(manifest.contentKey.indexOf(":") + 1),
      fetchId: manifest.fetchId,
      effectivePostKey: manifest.contentKey,
      notePath: manifest.notePath,
      attachmentPaths: Object.freeze(attachmentResults
        .filter((item) => item.status === "saved" || item.status === "skipped")
        .map((item) => item.path)),
      media: Object.freeze(attachmentResults.map((item) => ({
        mediaKey: `${manifest.contentKey}:media:${item.mediaId}`,
        path: item.path,
        status: item.status
      }))),
      ...(context.monitoringInstanceId ? { monitoringInstanceId: context.monitoringInstanceId } : {}),
      sourceUrl,
      mediaPolicy: manifest.mediaPolicy,
      writtenAt,
      firstWrittenAt: context.firstWrittenAt ?? writtenAt,
      lastVerifiedAt: writtenAt,
      physicalStatus: partial ? "partial" : "active",
      lastActionId: context.actionId ?? manifest.managedDigest,
      managedDigest: manifest.managedDigest,
      status: manifest.action === "new"
        ? "written"
        : manifest.action === "update" ? "updated" : "skipped_duplicate",
      completion: partial ? "partial" : "complete"
    },
    attachments: Object.freeze(attachmentResults)
  };
}

export function replaceManagedBlock(current: string, next: string): string {
  const range = managedRange(current);
  if (!range) throw new AgentLensError("vault_conflict", "Managed block markers are missing.", false);
  return `${current.slice(0, range.start)}${next}${current.slice(range.end)}`;
}

function managedContent(content: string): string {
  return content
    .replace(/\n*<!-- agentlens:(?:managed:)?start -->\n/g, "\n")
    .replace(/<!-- agentlens:identity:[^\n]* -->\n/g, "")
    .replace(/<!-- agentlens:metadata:[^\n]* -->\n/g, "")
    .replace(/\n<!-- agentlens:(?:managed:)?end -->$/, "");
}

function extractManagedBlock(content: string): string | null {
  const range = managedRange(content);
  return range ? content.slice(range.start, range.end) : null;
}

function managedRange(content: string): { start: number; end: number } | null {
  for (const [startMarker, endMarker] of [[MANAGED_START, MANAGED_END], [LEGACY_MANAGED_START, LEGACY_MANAGED_END]] as const) {
    const start = content.indexOf(startMarker);
    const end = content.indexOf(endMarker, start + startMarker.length);
    if (start >= 0 && end >= start) {
      const heading = content.lastIndexOf("\n# ", start);
      if (heading < 0 && !content.startsWith("# ")) return null;
      return { start: heading < 0 ? 0 : heading + 1, end: end + endMarker.length };
    }
  }
  // Without legacy markers, only replace an unambiguous template. A source
  // caption or user note may itself contain Markdown headings.
  if (["\n## Content\n", "\n## Media\n", "\n\n## Note\n"].some(marker =>
    content.indexOf(marker) !== content.lastIndexOf(marker))) return null;
  const contentHeading = content.indexOf("\n## Content\n");
  if (contentHeading < 0) return null;
  const titleStart = content.lastIndexOf("\n# ", contentHeading);
  const start = titleStart < 0 && content.startsWith("# ") ? 0 : titleStart + 1;
  if (start < 0 || !content.slice(start, contentHeading).startsWith("# ")) return null;
  const mediaHeading = content.indexOf("\n## Media\n", contentHeading);
  const noteHeading = content.indexOf("\n\n## Note\n", mediaHeading);
  if (mediaHeading < 0 || noteHeading < 0) return null;
  return { start, end: noteHeading };
}

function renderManagedBlock(post: NormalizedPost, attachments: readonly AttachmentWriteManifest[]): string {
  const title = postDisplayTitle(post);
  const inlineMedia = new Set<string>();
  const content = postBodyMarkdown(cleanPostText(post.body?.trim() || post.text.trim() || post.summary?.trim() || ""), url => {
    const item = post.media.find(media => media.kind === "image" && media.sourceUrl === url);
    const attachment = item && attachments.find(candidate => candidate.mediaId === item.id);
    if (!item || !attachment || attachment.action === "link") return undefined;
    inlineMedia.add(item.id);
    return `![[${attachment.path}]]`;
  });
  // Keep the source caption intact; only append tags absent from that caption.
  const inlineTags = new Set([...content.matchAll(/(?:^|[^\p{L}\p{N}_/#])#([\p{L}\p{N}_-]+)/gu)]
    .map(match => match[1]!.normalize("NFKC").toLocaleLowerCase()));
  const tags = postContentTags(post).filter(tag => {
    const key = tag.normalize("NFKC").toLocaleLowerCase();
    if (inlineTags.has(key)) return false;
    inlineTags.add(key);
    return true;
  });
  const contentWithTags = [content, tags.map(tag => `#${tag.replace(/^#/, "")}`).join(" ")]
    .filter(Boolean).join("\n\n");
  const media = post.media.filter(item => !inlineMedia.has(item.id)).map(item => {
    const attachment = attachments.find(candidate => candidate.mediaId === item.id);
    const source = attachment?.sourceUrl ?? redactPersistentUrl(item.sourceUrl, item.downloadUrlExpiresAt);
    return attachment && attachment.action !== "link"
      ? `- ![[${attachment.path}]]${source ? ` ([source](${source}))` : ""}`
      : source ? `- [source](${source})` : `- ${item.kind} source unavailable`;
  }).join("\n");
  return `# ${title}\n\n## Content\n${contentWithTags || "_No text was returned._"}\n\n## Media\n${media || (inlineMedia.size ? "_Media embedded in the content above._" : "_No media was returned._")}`;
}

/** Before writing, show a remote image/cover rather than a nonexistent Vault embed. */
export function renderNotePreview(post: NormalizedPost, manifest: NoteWriteManifest, savedPaths: readonly string[] = []): string {
  let markdown = manifest.renderedManagedBlock;
  for (const attachment of manifest.attachments) {
    if (attachment.action === "skip" || savedPaths.includes(attachment.path)) continue;
    const media = post.media.find(item => item.id === attachment.mediaId);
    const preview = (media?.kind === "image" ? media.sourceUrl : "") || media?.thumbnailUrl || media?.coverUrl;
    const safe = preview && /^https?:\/\//i.test(preview) ? preview.replace(/\)/g, "%29") : "";
    markdown = markdown.replaceAll(`![[${attachment.path}]]`, safe ? `![Media preview](${safe})` : "Media will be downloaded when saved.");
  }
  return `${markdown}\n\n## Note\n`;
}

async function availableNotePath(vault: VaultPort, preferredPath: string, key: string, sourceUrl: string, reuseIdentity = true, forceSuffix = false): Promise<string> {
  const preferred = vault.getFile(preferredPath);
  if (!preferred && !forceSuffix) return preferredPath;
  const identity = `<!-- agentlens:identity:${encodeURIComponent(key)} -->`;
  const matches = async (file: VaultFileRef) => vault.matchesAgentLensKey
    ? vault.matchesAgentLensKey(file, key, sourceUrl)
    : (await vault.readText(file)).includes(identity);
  if (preferred && reuseIdentity && await matches(preferred)) return preferredPath;

  const stem = preferredPath.replace(/\.md$/, "");
  for (let sequence = 2; sequence <= 999; sequence += 1) {
    const candidate = `${stem}_${String(sequence).padStart(2, "0")}.md`;
    const file = vault.getFile(candidate);
    if (!file || reuseIdentity && await matches(file)) return candidate;
  }
  throw new AgentLensError("vault_conflict", "No safe note filename is available in the destination folder.", false);
}

function noteFilename(post: NormalizedPost, _fetchedAt: string): string {
  const published = validDatePrefix(post.publishedAt) ?? "undated";
  const platform = filenamePart(post.platform, 40) || "source";
  const creator = filenamePart(creatorDisplayName(post.author), 60) || "creator";
  const titleText = cleanPostTitle(post.title ?? "") || cleanPostTitle(post.text.split(/\r?\n/)[0] ?? "");
  const title = filenamePart(titleText.split(/\s+/).slice(0, 10).join(" "), 100).replace(/[._ -]+$/, "") || "untitled";
  if (post.platform === "x") {
    const words = titleText.split(/\s+/).slice(0, 10);
    const readable = words.reduce((result, word) => {
      const next = [result, filenamePart(word, 100)].filter(Boolean).join(" ");
      return new TextEncoder().encode(next).length <= 100 ? next : result;
    }, "").replace(/[. -]+$/, "") || "Untitled";
    return `X - ${creator.replaceAll("_", " ")} - ${published} - ${readable}.md`;
  }
  return `${platform}_${creator}_${published}_${title}.md`;
}

function filenamePart(value: string, maxBytes: number): string {
  // Limit bytes as well as characters so CJK/emoji names fit filesystem limits.
  let result = "";
  for (const char of Array.from(value.normalize("NFKC"), char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? "_" : char).join("").replace(/[\\/:*?"<>|#^[\]]/g, "_").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")) {
    if (new TextEncoder().encode(result + char).length > maxBytes) break;
    result += char;
  }
  return result;
}

function slug(value: string): string {
  const tag = value.normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return /^\p{N}+$/u.test(tag) ? `creator-${tag}` : tag;
}

function validDatePrefix(value: string | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return value.slice(0, 10);
}

function noteTags(post: NormalizedPost, options: VaultWriterOptions): string[] {
  const tags: string[] = [];
  if (options.addPlatformTag !== false) tags.push(post.platform.trim().toLowerCase());
  if (options.addCreatorTag !== false) {
    const creator = slug(creatorDisplayName(post.author)).toLowerCase();
    if (creator) tags.push(creator);
  }
  if (options.addMediaTags) {
    for (const kind of new Set(post.media.map((media) => media.kind))) tags.push(`media/${kind}`);
  }
  return tags;
}

function stableDigest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function freezeManifest(input: {
  key: string;
  fetchId?: string | undefined;
  notePath: string;
  action: NoteWriteAction;
  saveAsCopy?: boolean | undefined;
  alreadySaved?: boolean | undefined;
  reason: string;
  managedDigest: string;
  renderedManagedBlock: string;
  frontmatter: Readonly<Record<string, unknown>>;
  attachments: readonly AttachmentWriteManifest[];
  mediaPolicy: MediaPolicy;
  templateId: "default" | "compact";
  expectedOutcome: "complete" | "partial";
  partialReasons: readonly string[];
}): NoteWriteManifest {
  return Object.freeze({
    contentKey: input.key,
    ...(input.fetchId ? { fetchId: input.fetchId } : {}),
    notePath: input.notePath,
    action: input.action,
    ...(input.saveAsCopy ? { saveAsCopy: true } : {}),
    alreadySaved: input.alreadySaved || input.action === "skip" || input.action === "update",
    reason: input.reason,
    managedDigest: input.managedDigest,
    mediaPolicy: input.mediaPolicy,
    templateId: input.templateId,
    expectedOutcome: input.expectedOutcome,
    partialReasons: input.partialReasons,
    renderedManagedBlock: input.renderedManagedBlock,
    frontmatter: input.frontmatter,
    attachments: input.attachments
  });
}

function planAttachments(
  vault: VaultPort,
  post: NormalizedPost,
  notePath: string,
  policy: MediaPolicy,
  maxDownloadBytes?: number,
  now: Date = new Date(),
  existingMediaPaths: Readonly<Record<string, string>> = {}
): AttachmentWriteManifest[] {
  const noteStem = notePath.slice(notePath.lastIndexOf("/") + 1, -3);
  const folder = `${notePath.slice(0, notePath.lastIndexOf("/"))}/attachments/${noteStem}`;
  return post.media.map((media, index) => {
    const shouldDownload = policy === "download_all"
      || policy === "download_images_only" && media.kind === "image";
    const filename = `${noteStem}_${String(index + 1).padStart(2, "0")}.${attachmentExtension(media)}`;
    const existingPath = existingMediaPaths[media.id];
    const path = existingPath && vault.getFile(existingPath) ? existingPath : `${folder}/${filename}`;
    const tooLarge = shouldDownload && maxDownloadBytes !== undefined && media.sizeBytes !== undefined && media.sizeBytes > maxDownloadBytes;
    const expired = shouldDownload && media.downloadUrlExpiresAt !== undefined
      && Number.isFinite(Date.parse(media.downloadUrlExpiresAt))
      && Date.parse(media.downloadUrlExpiresAt) <= now.getTime();
    const partialReason = tooLarge
      ? `media exceeds the ${maxDownloadBytes} byte host limit`
      : expired ? "media URL is expired and may require refresh" : undefined;
    return Object.freeze({
      mediaId: media.id,
      path,
      sourceUrl: redactPersistentUrl(media.sourceUrl, media.downloadUrlExpiresAt),
      action: shouldDownload ? tooLarge ? "link" as const : vault.getFile(path) ? "skip" as const : "new" as const : "link" as const,
      ...(partialReason ? { partialReason } : {})
    });
  });
}

function attachmentExtension(media: NormalizedMedia): string {
  const fallback = media.kind === "image" ? "jpg" : media.kind === "video" ? "mp4" : media.kind === "audio" ? "mp3" : "bin";
  const extension = media.extension?.replace(/^\./, "");
  return extension && /^[a-zA-Z0-9]{1,8}$/.test(extension) ? extension : fallback;
}
