import { MediaDownloadError } from "@/core/mediaFailure";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedPost } from "@/core/domain";
import { normalizeVaultRelativePath, renderNotePreview, VaultWriter, type VaultFileRef, type VaultPort } from "@/vault/VaultWriter";

class MemoryVault implements VaultPort {
  readonly files = new Map<string, string>();
  readonly frontmatter = new Map<string, Record<string, unknown>>();
  readonly keysByPath = new Map<string, string>();
  getFile(path: string): VaultFileRef | null { return this.files.has(path) ? { path } : null; }
  async readText(file: VaultFileRef) { return this.files.get(file.path) ?? ""; }
  async createText(path: string, content: string) { this.files.set(path, content); return { path }; }
  async modifyText(file: VaultFileRef, content: string) { this.files.set(file.path, content); }
  async ensureFolder() {}
  async createBinary(path: string) { this.files.set(path, "<binary>"); return { path }; }
  async updateFrontmatter(file: VaultFileRef, values: Readonly<Record<string, unknown>>) {
    this.frontmatter.set(file.path, { ...(this.frontmatter.get(file.path) ?? {}), ...values });
  }
  async recordNoteIdentity(file: VaultFileRef, key: string) { this.keysByPath.set(file.path, key); }
  async matchesAgentLensKey(file: VaultFileRef, contentKey: string, sourceUrl: string): Promise<boolean> {
    const indexed = this.keysByPath.get(file.path);
    if (indexed) return indexed === contentKey;
    const values = this.frontmatter.get(file.path);
    return Boolean(values?.agentlens_effective_post_key === contentKey || values?.agentlens_key === contentKey
      || values?.Source_url === sourceUrl && String(values.Platform).toLowerCase() === contentKey.split(":")[0]
      || this.files.get(file.path)?.includes(`<!-- agentlens:identity:${encodeURIComponent(contentKey)} -->`));
  }
  async findByAgentLensKey(folderPath: string, contentKey: string, sourceUrl: string): Promise<VaultFileRef | null> {
    const prefix = `${folderPath}/`;
    const path = [...this.frontmatter.entries()].find(([candidate, values]) =>
      candidate.startsWith(prefix)
      && (values.agentlens_effective_post_key === contentKey || values.agentlens_key === contentKey)
    )?.[0];
    let matched = path;
    for (const candidate of this.files.keys()) {
      if (!matched && candidate.startsWith(prefix) && await this.matchesAgentLensKey({ path: candidate }, contentKey, sourceUrl)) matched = candidate;
    }
    return matched ? { path: matched } : null;
  }
}

const POST: NormalizedPost = {
  platform: "YouTube",
  contentId: "video-42",
  canonicalUrl: "https://youtube.com/watch?v=video-42",
  title: "A useful source",
  text: "Original summary",
  publishedAt: "2026-08-19T12:00:00.000Z",
  author: { id: "author-1", displayName: "Researcher", handle: "researcher" },
  media: []
};

describe("VaultWriter", () => {
  it("writes and recovers notes in Vault root without an absolute path or invented directory", async () => {
    const vault = new MemoryVault();
    const ensure = vi.spyOn(vault, "ensureFolder");
    const writer = new VaultWriter(vault, {folderPath: ""});
    const manifest = await writer.plan(POST);
    const mediaManifest = await writer.plan({...POST,media:[{id:"root-image",kind:"image",sourceUrl:"https://cdn.example/image.jpg"}]});
    expect(mediaManifest.attachments[0]!.path).toMatch(/^attachments\//);
    expect(manifest.notePath).not.toContain("/");
    const saved = await writer.execute(manifest, POST.canonicalUrl);
    expect(vault.files.has(saved.file.path)).toBe(true);
    expect(ensure).not.toHaveBeenCalled();
    const replay = await writer.plan(POST, {targetNotePath: saved.file.path});
    expect(replay.notePath).toBe(saved.file.path);
    await expect(writer.plan(POST, {targetNotePath: "Other/note.md"})).rejects.toThrow("outside");
    await expect(new VaultWriter(vault, {folderPath: "../outside"}).plan(POST)).rejects.toThrow();
  });

  it("uses the same cleaned title for a non-Zhihu note heading and filename", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Research" });
    const manifest = await writer.plan({ ...POST, platform: "linkedin", title: "&lt;p&gt;A &amp; B&lt;/p&gt;" });
    expect(manifest.renderedManagedBlock).toContain("# A & B\n");
    expect(manifest.notePath).toContain("A_&_B.md");
    expect(manifest.notePath).not.toContain("p_gt");
  });

  it("uses a readable X filename and the first caption line when title is absent", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Research" });
    const manifest = await writer.plan({ ...POST, platform: "x", title: undefined,
      text: "Additional preflight testing on Super Heavy complete.\nDetails follow", author: { id: "spacex", displayName: "SpaceX" } });
    expect(manifest.notePath).toBe("Research/X - SpaceX - 2026-08-19 - Additional preflight testing on Super Heavy complete.md");
    expect(manifest.renderedManagedBlock).toContain("# Post from SpaceX");
  });

  it("uses an untitled fallback only when title and caption are empty", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Research" });
    const manifest = await writer.plan({ ...POST, platform: "instagram", title: undefined, text: "" });
    expect(manifest.notePath).toContain("_untitled.md");
  });
  it("plans and executes a deterministic new note", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox", now: () => new Date("2026-08-19T13:00:00.000Z") });
    const manifest = await writer.plan(POST, { fetchId: "fetch-42" });

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(manifest).toMatchObject({
      action: "new",
      contentKey: "youtube:video-42",
      notePath: "AgentLens/Inbox/YouTube_Researcher_2026-08-19_A_useful_source.md"
    });
    expect(manifest.frontmatter).toMatchObject({
      Creator_name: "Researcher",
      Fetched_at: "2026-08-19T13:00:00.000Z",
      Media_policy: "download_all",
      tags: ["youtube", "researcher"]
    });
    const result = await writer.execute(manifest, POST.canonicalUrl);
    expect(vault.files.get(result.file.path)).not.toContain("<!-- agentlens:");
    expect(result.ledger).toMatchObject({ destination: "obsidian", status: "written", completion: "complete", physicalStatus: "active", contentId: "video-42", fetchId: "fetch-42" });
    expect(manifest.frontmatter.Source_url).toBe(POST.canonicalUrl);
    expect(manifest.renderedManagedBlock).not.toContain("## Summary");
    expect(manifest.renderedManagedBlock).not.toContain("## Transcript");
    expect(vault.files.get(result.file.path)).toContain("## Content");
    expect(vault.files.get(result.file.path)).toContain("## Note");
  });

  it("retains original caption hashtags even when no media tags were returned", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" });
    const manifest = await writer.plan({ ...POST, text: "正文 #摄影[话题]# #旅行 #摄影", media: [] });
    expect(manifest.renderedManagedBlock).toContain("正文 #摄影  #旅行 #摄影");
    expect(manifest.renderedManagedBlock).not.toContain("## Tags");
    expect(manifest.renderedManagedBlock).not.toContain("[话题]");
  });

  it("appends unique media tags below Content without a Tags section", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" });
    const manifest = await writer.plan({
      ...POST,
      media: [
        { id: "image-1", kind: "image", sourceUrl: "https://cdn.example/1.jpg", tags: ["camera", "review"] },
        { id: "image-2", kind: "image", sourceUrl: "https://cdn.example/2.jpg", tags: ["review", "workflow"] }
      ]
    });

    expect(manifest.renderedManagedBlock).toContain("## Content\nOriginal summary\n\n#camera #review #workflow\n\n## Media");
    expect(manifest.renderedManagedBlock).not.toContain("## Tags");
  });

  it("keeps provider-generated platform and creator labels out of body tags", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" });
    const manifest = await writer.plan({ ...POST, text: "Original #research", media: [
      { id: "image-1", kind: "image", sourceUrl: "https://cdn.example/1.jpg", tags: [POST.platform, POST.author.displayName, "research"] }
    ] });
    expect(manifest.renderedManagedBlock).toContain("Original #research");
    expect(manifest.renderedManagedBlock).not.toContain("## Tags");
    expect(manifest.renderedManagedBlock).not.toContain(`## Tags\n#${POST.platform}`);
    expect(manifest.frontmatter.tags).toContain(POST.platform.toLowerCase());
  });

  it("updates only the managed block and preserves user text and frontmatter", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox" });
    const initial = await writer.plan(POST);
    const first = await writer.execute(initial, POST.canonicalUrl);
    const legacyManaged = (vault.files.get(first.file.path) ?? "")
      .replace("\n\n## Content", "\n\n<!-- agentlens:managed:start -->\n<!-- agentlens:identity:youtube%3Avideo-42 -->\n<!-- agentlens:metadata:%7B%7D -->\n## Content")
      .replace("\n\n## Note", "\n<!-- agentlens:managed:end -->\n\n## Note");
    vault.files.set(first.file.path, `User preface\n${legacyManaged}\nUser analysis`);
    vault.frontmatter.set(first.file.path, { user_tag: "keep" });

    const changed = { ...POST, text: "Updated source summary" };
    const update = await writer.plan(changed);
    expect(update.action).toBe("update");
    await writer.execute(update, changed.canonicalUrl);

    expect(vault.files.get(first.file.path)).toContain("User preface");
    expect(vault.files.get(first.file.path)).toContain("User analysis");
    expect(vault.files.get(first.file.path)).toContain("Updated source summary");
    expect(vault.files.get(first.file.path)).not.toContain("<!-- agentlens:");
    expect(vault.files.get(first.file.path)).not.toContain("<!-- agentlens:managed:start -->");
    expect(vault.frontmatter.get(first.file.path)).toMatchObject({ user_tag: "keep", Platform: "YouTube" });
  });

  it("finds the managed block even when earlier user text contains a stray end marker", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox" });
    const first = await writer.plan(POST);
    const written = await writer.execute(first, POST.canonicalUrl);
    const original = vault.files.get(written.file.path) ?? "";
    vault.files.set(written.file.path, `<!-- agentlens:end -->\n${original}`);

    const changedPost = { ...POST, text: "Changed source text" };
    const changed = await writer.plan(changedPost);

    expect(changed.action).toBe("update");
    await expect(writer.execute(changed, changedPost.canonicalUrl)).resolves.toMatchObject({
      ledger: { status: "updated" }
    });
    expect(vault.files.get(written.file.path)).toContain("Changed source text");
  });

  it("blocks updates when user Markdown makes the marker-free template ambiguous", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    const first = await writer.execute(await writer.plan(POST), POST.canonicalUrl);
    vault.files.set(first.file.path, `${vault.files.get(first.file.path)}\n## Media\nMy own analysis`);
    const before = vault.files.get(first.file.path);

    expect((await writer.plan({ ...POST, text: "Changed source" })).action).toBe("blocked");
    expect(vault.files.get(first.file.path)).toBe(before);
  });

  it("avoids an unmanaged filename collision and rejects unsafe identity or paths", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox" });
    const path = (await writer.plan(POST)).notePath;
    vault.files.set(path, "User-owned note");

    expect(await writer.plan(POST)).toMatchObject({
      action: "new",
      notePath: path.replace(/\.md$/, "_02.md")
    });
    expect(() => normalizeVaultRelativePath("../outside")).toThrow(/escape the vault/i);
    expect(() => normalizeVaultRelativePath("/absolute")).toThrow(/relative path/i);
    expect(normalizeVaultRelativePath(" Research//AgentLens/ ")).toBe("Research/AgentLens");
    await expect(writer.plan({ ...POST, contentId: " " })).rejects.toThrow(/stable content identity/i);
    await expect(writer.plan({ ...POST, platform: " " })).rejects.toThrow(/stable content identity/i);
    await expect(writer.plan({
      ...POST,
      media: [{ id: " ", kind: "image", sourceUrl: "https://cdn.example/image.jpg" }]
    })).rejects.toThrow(/stable media identity/i);
    await expect(writer.plan({
      ...POST,
      media: [
        { id: "duplicate", kind: "image", sourceUrl: "https://cdn.example/a.jpg" },
        { id: "duplicate", kind: "image", sourceUrl: "https://cdn.example/b.jpg" }
      ]
    })).rejects.toThrow(/unique within a post/i);
  });

  it("finds a moved managed note by stable frontmatter key instead of creating a duplicate", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox" });
    const first = await writer.execute(await writer.plan(POST), POST.canonicalUrl);
    const movedPath = "AgentLens/Inbox/Manually renamed research note.md";
    vault.files.set(movedPath, vault.files.get(first.file.path)!);
    vault.files.delete(first.file.path);
    vault.frontmatter.set(movedPath, vault.frontmatter.get(first.file.path)!);
    vault.frontmatter.delete(first.file.path);
    vault.keysByPath.delete(first.file.path);

    expect(await writer.plan(POST)).toMatchObject({ action: "skip", notePath: movedPath });
  });

  it("uses undated rather than inventing a publication date", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" });

    expect((await writer.plan({ ...POST, publishedAt: undefined }, { fetchedAt: "2026-08-20T07:00:00Z" })).notePath)
      .toContain("_undated_");
    expect((await writer.plan({ ...POST, publishedAt: "not-a-date" }, { fetchedAt: "2026-08-21T07:00:00Z" })).notePath)
      .toContain("_undated_");
  });

  it("skips unchanged managed content", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox" });
    const manifest = await writer.plan(POST);
    await writer.execute(manifest, POST.canonicalUrl);
    expect((await writer.plan(POST)).action).toBe("skip");
  });

  it("saves repeated manual imports as separate notes and attachments without changing the first", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox" });
    const post = { ...POST, media: [{ id: "cover", kind: "image" as const, sourceUrl: "https://cdn.example/cover.jpg" }] };
    const first = await writer.execute(await writer.plan(post, { saveAsCopy: true }), post.canonicalUrl,
      async () => new Uint8Array([1]).buffer);
    const original = vault.files.get(first.file.path);
    const secondPlan = await writer.plan(post, { saveAsCopy: true,
      existingMediaPaths: { cover: first.manifest.attachments[0]!.path }, existingMediaNotePath: first.file.path });
    expect(secondPlan).toMatchObject({ action: "new", saveAsCopy: true, alreadySaved: true });
    expect(secondPlan.notePath).toMatch(/_02\.md$/);
    expect(secondPlan.attachments[0]?.path).not.toBe(first.manifest.attachments[0]?.path);
    const second = await writer.execute(secondPlan, post.canonicalUrl, async () => new Uint8Array([2]).buffer);
    expect(vault.files.get(first.file.path)).toBe(original);
    expect(second.file.path).not.toBe(first.file.path);
    expect((await writer.plan(post)).action).toBe("skip");
  });

  it("saves edited content from the same post as a new manual note", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    const first = await writer.execute(await writer.plan(POST, { saveAsCopy: true }), POST.canonicalUrl);
    const original = vault.files.get(first.file.path);
    const edited = { ...POST, text: "The author edited this caption." };
    const next = await writer.plan(edited, { saveAsCopy: true });
    expect(next.action).toBe("new");
    expect(next.notePath).toMatch(/_02\.md$/);
    const second = await writer.execute(next, edited.canonicalUrl);
    expect(vault.files.get(first.file.path)).toBe(original);
    expect(vault.files.get(second.file.path)).toContain(edited.text);
  });

  it("keeps the second-copy suffix after the first note was renamed", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    const first = await writer.execute(await writer.plan(POST, { saveAsCopy: true }), POST.canonicalUrl);
    const moved = "Inbox/renamed-by-user.md";
    vault.files.set(moved, vault.files.get(first.file.path)!);
    vault.files.delete(first.file.path);
    vault.frontmatter.set(moved, vault.frontmatter.get(first.file.path)!);
    vault.frontmatter.delete(first.file.path);
    vault.keysByPath.delete(first.file.path);

    expect((await writer.plan(POST, { saveAsCopy: true })).notePath).toMatch(/_02\.md$/);
  });

  it("appends only missing tags to Content identically in preview and saved note", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    const post = { ...POST, text: "Caption #海边 #旅行", media: [{ id: "cover", kind: "image" as const,
      sourceUrl: "https://cdn.example/cover.jpg", tags: ["旅行", "风景"] }] };
    const manifest = await writer.plan(post, { saveAsCopy: true });
    const preview = renderNotePreview(post, manifest);
    const saved = await writer.execute(manifest, post.canonicalUrl);
    const content = (value: string) => value.split("## Content\n")[1]?.split("\n\n## Media")[0];
    expect(content(preview)).toBe("Caption #海边 #旅行\n\n#风景");
    expect(preview).not.toContain("## Tags");
    expect(preview.match(/#海边/g)).toHaveLength(1);
    expect(preview.match(/#旅行/g)).toHaveLength(1);
    expect(content(vault.files.get(saved.file.path)!)).toBe(content(preview));
  });

  it("deduplicates returned tags across media, casing and compatibility forms", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox" });
    const manifest = await writer.plan({ ...POST, text: "Caption #Art", media: [
      { id: "a", kind: "image", sourceUrl: "https://cdn.example/a.jpg", tags: ["art", "#旅行", "Camera"] },
      { id: "b", kind: "image", sourceUrl: "https://cdn.example/b.jpg", tags: ["旅行", "camera", "Ｃａｍｅｒａ"] }
    ] });
    expect(manifest.renderedManagedBlock).toContain("## Content\nCaption #Art\n\n#旅行 #Camera\n\n## Media");
    expect(manifest.renderedManagedBlock).not.toContain("## Tags");
  });

  it("shows tags as Content when the source has no caption", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox" });
    const manifest = await writer.plan({ ...POST, text: "", media: [
      { id: "a", kind: "image", sourceUrl: "https://cdn.example/a.jpg", tags: ["旅行"] }
    ] });
    expect(manifest.renderedManagedBlock).toContain("## Content\n#旅行\n\n## Media");
    expect(manifest.renderedManagedBlock).not.toContain("No text was returned");
  });

  it("keeps the preview body identical to the saved note and preserves inline hashtags", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    const post = { ...POST, text: "Caption #旅行，#摄影 #Art", media: [{ id: "m", kind: "image" as const,
      sourceUrl: "https://cdn.example/a.jpg", tags: ["旅行", "摄影", "art"] }] };
    const manifest = await writer.plan(post);
    expect(manifest.renderedManagedBlock).not.toContain("## Tags");
    expect(manifest.renderedManagedBlock).toContain(post.text);
    const textOnly = await writer.plan({ ...POST, media: [] });
    const saved = await writer.execute(textOnly, POST.canonicalUrl);
    expect(renderNotePreview(POST, textOnly).trimEnd()).toBe(vault.files.get(saved.file.path)!.trimEnd());
    expect(vault.frontmatter.get(saved.file.path)).toEqual(textOnly.frontmatter);
  });

  it("turns punctuation in creator names into valid Obsidian tags", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox" });
    const manifest = await writer.plan({ ...POST, author: { ...POST.author, displayName: "what about it!" } });
    expect(manifest.frontmatter.Creator_name).toBe("what about it!");
    expect(manifest.frontmatter.tags).toEqual(["youtube", "what-about-it"]);
  });

  it("downloads planned attachments and links them from the managed block", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox", mediaPolicy: "download_all" });
    const post = {
      ...POST,
      media: [{
        id: "image-1",
        kind: "image" as const,
        sourceUrl: "https://cdn.example/image.jpg",
        filename: "source image.jpg",
        extension: "jpg"
      }]
    };
    const manifest = await writer.plan(post);

    expect(manifest.attachments[0]).toMatchObject({ action: "new", mediaId: "image-1" });
    expect(manifest.renderedManagedBlock).toContain("![[AgentLens/Inbox/attachments/");
    expect(manifest.renderedManagedBlock).toContain("[source](https://cdn.example/image.jpg)");
    const result = await writer.execute(
      manifest,
      post.canonicalUrl,
      async () => new Uint8Array([1, 2, 3]).buffer
    );

    expect(result.ledger.completion).toBe("complete");
    expect(result.attachments[0]?.status).toBe("saved");
    expect(vault.files.has(manifest.attachments[0]!.path)).toBe(true);
  });

  it("keeps the note and marks it partial when an attachment fails", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox" });
    const post = {
      ...POST,
      media: [{ id: "video-1", kind: "video" as const, sourceUrl: "https://cdn.example/video.mp4" }]
    };
    const manifest = await writer.plan(post);
    const result = await writer.execute(manifest, post.canonicalUrl, async () => {
      throw new Error("timeout");
    });

    expect(result.ledger.completion).toBe("partial");
    expect(result.attachments[0]?.status).toBe("failed");
    expect(result.attachments[0]?.error).toBe("timeout");
    expect(vault.files.has(result.file.path)).toBe(true);
    expect(vault.files.get(result.file.path)).not.toContain("## Media archive warnings");
    expect(vault.files.get(result.file.path)).toContain("https://cdn.example/video.mp4");

    const retry = await writer.plan(post);
    expect(retry).toMatchObject({ action: "update" });
    expect(retry.attachments[0]).toMatchObject({ action: "new" });
    const retried = await writer.execute(retry, post.canonicalUrl, async () => new Uint8Array([4, 5]).buffer);
    expect(retried.ledger.completion).toBe("complete");
    expect(retried.attachments[0]?.status).toBe("saved");
    expect(vault.files.get(retried.file.path)).not.toContain("## Media archive warnings");
  });

  it.each(["https://cdn.example/video.mp4?quality=hd&part=1", "https://cdn.example/play?id=42"])("embeds a link-only video with controls and a source link without downloading: %s", async sourceUrl => {
    const vault = new MemoryVault();
    const createBinary = vi.spyOn(vault, "createBinary");
    const download = vi.fn();
    const writer = new VaultWriter(vault, { folderPath: "Inbox", mediaPolicy: "link_only" });
    const post: NormalizedPost = { ...POST, media: [{ id: "video-1", kind: "video", sourceUrl }] };
    const manifest = await writer.plan(post);
    const result = await writer.execute(manifest, post.canonicalUrl, download);
    const content = vault.files.get(result.file.path)!;
    const document = new DOMParser().parseFromString(content, "text/html");
    const video = document.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(sourceUrl);
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.getAttribute("preload")).toBe("metadata");
    expect(video.hasAttribute("poster")).toBe(false);
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.style.width).toBe("100%");
    expect(content).toContain(`[source](${sourceUrl})`);
    expect(renderNotePreview(post, manifest)).toContain("<video controls");
    expect(manifest.attachments[0]?.action).toBe("link");
    expect(result.attachments[0]?.status).toBe("linked");
    expect(createBinary).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it.each([
    { name: "video thumbnail", media: { thumbnailUrl: "https://cdn.example/thumb.jpg?width=640&height=360", coverUrl: "https://cdn.example/cover.jpg" }, expected: "https://cdn.example/thumb.jpg?width=640&height=360" },
    { name: "video cover", media: { coverUrl: "https://cdn.example/cover.jpg" }, expected: "https://cdn.example/cover.jpg" },
    { name: "expiring thumbnail falls back to cover", media: { thumbnailUrl: "https://cdn.example/private.jpg?opaque=secret", thumbnailExpiresAt: "2026-08-20T01:00:00Z", coverUrl: "https://cdn.example/cover.jpg" }, expected: "https://cdn.example/cover.jpg" },
    { name: "invalid thumbnail falls back to cover", media: { thumbnailUrl: "javascript:alert(1)", coverUrl: "https://cdn.example/cover.jpg" }, expected: "https://cdn.example/cover.jpg" },
    { name: "cover credentials are not persisted", media: { coverUrl: "https://user:secret@cdn.example/cover.jpg?token=secret&width=640#private" }, expected: "https://cdn.example/cover.jpg?width=640" },
    { name: "invalid cover is omitted", media: { coverUrl: "javascript:alert(1)" }, expected: null },
    { name: "expiring thumbnail without fallback is omitted", media: { thumbnailUrl: "https://cdn.example/private.jpg?opaque=secret", thumbnailExpiresAt: "2026-08-20T01:00:00Z" }, expected: null }
  ])("uses a persistent link-only poster: $name", async ({ media, expected }) => {
    const vault = new MemoryVault();
    const download = vi.fn();
    const createBinary = vi.spyOn(vault, "createBinary");
    const writer = new VaultWriter(vault, { folderPath: "Inbox", mediaPolicy: "link_only" });
    const post: NormalizedPost = { ...POST, media: [{ id: "video-1", kind: "video", sourceUrl: "https://cdn.example/video.mp4", ...media }] };
    const manifest = await writer.plan(post);
    const result = await writer.execute(manifest, post.canonicalUrl, download);
    const markdown = vault.files.get(result.file.path)!;
    for (const content of [markdown, renderNotePreview(post, manifest)]) {
      const document = new DOMParser().parseFromString(content, "text/html");
      const video = document.querySelector("video")!;
      expect(video.getAttribute("poster")).toBe(expected);
      expect(video.getAttribute("preload")).toBe("metadata");
      expect(video.hasAttribute("autoplay")).toBe(false);
      expect(content).not.toContain("secret");
    }
    expect(download).not.toHaveBeenCalled();
    expect(createBinary).not.toHaveBeenCalled();
  });

  it("uses the post cover when a link-only video has no cover of its own", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox", mediaPolicy: "link_only" });
    const manifest = await writer.plan({ ...POST, thumbnailUrl: "https://cdn.example/post-cover.jpg", media: [{ id: "video-1", kind: "video", sourceUrl: "https://cdn.example/video.mp4" }] });
    expect(manifest.renderedManagedBlock).toContain('poster="https://cdn.example/post-cover.jpg"');
  });

  it.each([
    ["https://cdn.example/original.jpg?width=1280&height=720", "https://cdn.example/original.jpg?width=1280&height=720"],
    ["https://cdn.example/photo(1).jpg", "https://cdn.example/photo%281%29.jpg"],
    ["https://cdn.example/original.jpg?token=secret&width=640", "https://cdn.example/original.jpg?width=640"]
  ])("embeds a link-only image and source link without downloading: %s", async (sourceUrl, expectedUrl) => {
    const vault = new MemoryVault();
    const createBinary = vi.spyOn(vault, "createBinary");
    const download = vi.fn();
    const writer = new VaultWriter(vault, { folderPath: "Inbox", mediaPolicy: "link_only" });
    const post: NormalizedPost = { ...POST, media: [{ id: "image-1", kind: "image", sourceUrl: sourceUrl!, thumbnailUrl: "https://cdn.example/thumbnail.jpg" }] };
    const manifest = await writer.plan(post);
    const result = await writer.execute(manifest, post.canonicalUrl, download);
    const content = vault.files.get(result.file.path)!;
    expect(content).toContain(`![Media image](${expectedUrl}) ([source](${expectedUrl}))`);
    expect(renderNotePreview(post, manifest)).toContain(`![Media image](${expectedUrl})`);
    expect(content).not.toContain("thumbnail.jpg");
    expect(content).not.toContain("secret");
    expect(manifest.attachments[0]?.action).toBe("link");
    expect(result.attachments[0]?.status).toBe("linked");
    expect(createBinary).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("keeps link-only article images inline without duplicating them in the Media section", async () => {
    const sourceUrl = "https://cdn.example/original.jpg";
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox", mediaPolicy: "link_only" });
    const manifest = await writer.plan({ ...POST, body: `<p>Before</p><img src="${sourceUrl}"><p>After</p>`, media: [{ id: "image-1", kind: "image", sourceUrl }] });
    expect(manifest.renderedManagedBlock).toContain(`Before\n\n![Media image](${sourceUrl}) ([source](${sourceUrl}))\n\nAfter`);
    expect(manifest.renderedManagedBlock.match(/!\[Media image\]/g)).toHaveLength(1);
    expect(manifest.renderedManagedBlock).toContain("_Media embedded in the content above._");
  });

  it.each(["download_all", "download_images_only"] as const)("keeps local image embeds under %s", async mediaPolicy => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox", mediaPolicy });
    const manifest = await writer.plan({ ...POST, media: [{ id: "image-1", kind: "image", sourceUrl: "https://cdn.example/original.jpg" }] });
    expect(manifest.attachments[0]?.action).toBe("new");
    expect(manifest.renderedManagedBlock).toContain("![[Inbox/attachments/");
    expect(manifest.renderedManagedBlock).not.toContain("![Media image]");
  });

  it.each(["download_all", "download_images_only"] as const)("keeps the existing video output under %s", async mediaPolicy => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox", mediaPolicy });
    const manifest = await writer.plan({ ...POST, media: [{ id: "video-1", kind: "video", sourceUrl: "https://cdn.example/video.mp4" }] });
    expect(manifest.renderedManagedBlock).not.toContain("<video");
    if (mediaPolicy === "download_all") expect(manifest.renderedManagedBlock).toContain("![[Inbox/attachments/");
    else expect(manifest.renderedManagedBlock).toContain("- [source](https://cdn.example/video.mp4)");
  });

  it("does not embed a video with a non-web source", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox", mediaPolicy: "link_only" });
    const manifest = await writer.plan({ ...POST, media: [{ id: "video-1", kind: "video", sourceUrl: "javascript:alert(1)" }] });
    expect(manifest.renderedManagedBlock).not.toContain("<video");
    expect(manifest.renderedManagedBlock).toContain("video source unavailable");
  });

  it("uses remote links without downloading under link-only policy", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox", mediaPolicy: "link_only" });
    const post = {
      ...POST,
      media: [{ id: "audio-1", kind: "audio" as const, sourceUrl: "https://cdn.example/audio.mp3" }]
    };
    const manifest = await writer.plan(post);
    const result = await writer.execute(manifest, post.canonicalUrl);

    expect(manifest.attachments[0]?.action).toBe("link");
    expect(manifest.renderedManagedBlock).toContain("[source](https://cdn.example/audio.mp3)");
    expect(result.attachments[0]?.status).toBe("linked");
    expect(result.ledger.completion).toBe("complete");
  });

  it("marks a known oversized archive as partial before confirmation and keeps the remote source", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox", maxDownloadBytes: 10 });
    const post = {
      ...POST,
      media: [{ id: "video-large", kind: "video" as const, sourceUrl: "https://cdn.example/large.mp4", sizeBytes: 11 }]
    };
    const manifest = await writer.plan(post);

    expect(manifest).toMatchObject({ expectedOutcome: "partial" });
    expect(manifest.partialReasons[0]).toMatch(/host limit/);
    expect(manifest.attachments[0]).toMatchObject({ action: "link", mediaId: "video-large" });

    const result = await writer.execute(manifest, post.canonicalUrl);
    expect(result.ledger).toMatchObject({ completion: "partial", physicalStatus: "partial" });
    expect(vault.files.get(result.file.path)).toContain("https://cdn.example/large.mp4");
  });

  it("maps legacy compact settings to the default template safely", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "AgentLens/Inbox", templateId: "compact" });
    const manifest = await writer.plan(POST);

    expect(manifest.templateId).toBe("default");
    expect(manifest.renderedManagedBlock).toContain("# A useful source");
    expect(manifest.renderedManagedBlock).not.toContain("<!-- agentlens:");
  });

  it("applies user-controlled platform, creator and media frontmatter tags", async () => {
    const writer = new VaultWriter(new MemoryVault(), {
      folderPath: "AgentLens/Inbox",
      addPlatformTag: false,
      addCreatorTag: true,
      addMediaTags: true
    });
    const manifest = await writer.plan({
      ...POST,
      media: [
        { id: "image-1", kind: "image", sourceUrl: "https://cdn.example/image.jpg" },
        { id: "video-1", kind: "video", sourceUrl: "https://cdn.example/video.mp4" }
      ]
    });

    expect(manifest.frontmatter.tags).toEqual([
      "researcher", "media/image", "media/video"
    ]);
  });

  it("never persists signed media query credentials in Markdown or manifests", async () => {
    const writer = new VaultWriter(new MemoryVault(), {
      folderPath: "AgentLens/Inbox",
      mediaPolicy: "link_only"
    });
    const manifest = await writer.plan({
      ...POST,
      media: [{
        id: "signed-video",
        kind: "video",
        sourceUrl: "https://cdn.example/video.mp4?X-Amz-Signature=secret&X-Amz-Credential=private",
        thumbnailUrl: "https://cdn.example/thumb.jpg?opaque=thumbnail-secret&width=320",
        thumbnailExpiresAt: "2026-08-20T01:00:00Z",
        downloadUrlExpiresAt: "2026-08-20T01:00:00Z"
      }]
    });

    expect(manifest.renderedManagedBlock).toContain("https://cdn.example/video.mp4");
    expect(manifest.renderedManagedBlock).not.toContain("https://cdn.example/thumb.jpg");
    expect(manifest.renderedManagedBlock).not.toContain("width=320");
    expect(JSON.stringify(manifest)).not.toContain("secret");
    expect(JSON.stringify(manifest)).not.toContain("private");
    expect(JSON.stringify(manifest)).not.toContain("X-Amz");
  });
});

describe("0920 template and identity regressions", () => {
  it("never overwrites another managed post with the same readable filename", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    const first = await writer.plan(POST);
    const secondPost = { ...POST, contentId: "different-post" };
    const secondBeforeWrite = await writer.plan(secondPost);
    await writer.execute(first, POST.canonicalUrl);
    const second = await writer.resolveNewCollision(secondPost, secondBeforeWrite);
    expect(second.notePath).toMatch(/_02\.md$/);
    await writer.execute(second, secondPost.canonicalUrl);
    expect((await writer.plan(POST)).notePath).toBe(first.notePath);
    expect((await writer.plan(secondPost)).notePath).toBe(second.notePath);
    expect(vault.files.get(first.notePath)).not.toContain("agentlens:");
  });

  it("uses public source properties before metadata-cache updates and retries the original path", async () => {
    const vault = new MemoryVault();
    vault.findByAgentLensKey = async () => null;
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    const first = await writer.plan(POST);
    await writer.execute(first, POST.canonicalUrl);
    expect(await writer.plan(POST)).toMatchObject({ action: "skip", notePath: first.notePath });
  });

  it("uses remote previews before download, local media after save, and only source for link-only", async () => {
    const { renderNotePreview } = await import("@/vault/VaultWriter");
    const post = { ...POST, title: undefined, body: "Caption #摄影[话题]#", text: "Caption #摄影[话题]#",
      media: [{ id: "v", kind: "video" as const, sourceUrl: "https://cdn.example/v.mp4", coverUrl: "https://cdn.example/c.jpg" }] };
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox" });
    const manifest = await writer.plan(post);
    expect(manifest.renderedManagedBlock).toContain("# Post from Researcher");
    expect(manifest.renderedManagedBlock).toContain("Caption #摄影");
    expect(manifest.renderedManagedBlock).not.toContain("[话题]");
    expect(manifest.renderedManagedBlock).not.toContain("c.jpg");
    expect(renderNotePreview(post, manifest)).toContain("![Media preview](https://cdn.example/c.jpg)");
    expect(renderNotePreview(post, manifest)).not.toContain("![[");
    expect(renderNotePreview(post, manifest, [manifest.attachments[0]!.path])).toContain("![[");
    const links = await new VaultWriter(new MemoryVault(), { folderPath: "Inbox", mediaPolicy: "link_only" }).plan(post);
    expect(renderNotePreview(post, links)).not.toContain("![");
    expect(renderNotePreview(post, links)).toContain("[source](https://cdn.example/v.mp4)");
  });

  it("previews image originals rather than watermarked thumbnails and exposes only template properties", async () => {
    const { renderNotePreview } = await import("@/vault/VaultWriter");
    const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/original.jpg", thumbnailUrl: "https://cdn.example/watermarked.jpg" }] };
    const manifest = await new VaultWriter(new MemoryVault(), { folderPath: "Inbox" }).plan(post, { fetchId: "fetch-1" });
    expect(Object.keys(manifest.frontmatter)).toEqual(["Platform", "Creator_name", "Creator_url", "Source_url", "Published_at", "Fetched_at", "Media_count", "Media_policy", "tags"]);
    expect(manifest.renderedManagedBlock).not.toContain("agentlens:");
    const preview = renderNotePreview(post, manifest);
    expect(preview).toContain("![Media preview](https://cdn.example/original.jpg)");
    expect(preview).not.toContain("watermarked.jpg");
    expect(preview).not.toContain("agentlens-note-metadata");
    expect(preview).not.toContain("<dt>");
  });

  it("does not rewrite unchanged source content for a different fetch receipt", async () => {
    const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox" });
    const first = await writer.plan(POST, { fetchId: "first" });
    await writer.execute(first, POST.canonicalUrl);
    const repeated = await writer.plan(POST, { fetchId: "second" });
    expect(repeated.action).toBe("skip");
    expect(repeated.managedDigest).toBe(first.managedDigest);
  });

  it("cancels remaining downloads and preserves a partial note without broken embeds", async () => {
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    const controller = new AbortController();
    const post = { ...POST, media: [1, 2].map(id => ({ id: String(id), kind: "image" as const, sourceUrl: `https://cdn.example/${id}.jpg` })) };
    const manifest = await writer.plan(post);
    let calls = 0;
    const result = await writer.execute(manifest, post.canonicalUrl, async () => {
      calls++; controller.abort(); return new ArrayBuffer(3);
    }, { signal: controller.signal });
    expect(calls).toBe(1);
    expect(result.ledger.completion).toBe("partial");
    expect(result.ledger.attachmentPaths).toHaveLength(0);
    expect(vault.files.get(result.file.path)).not.toContain("![[");
    expect((await writer.plan(post)).notePath).toBe(result.file.path);
  });
});

it("reuses existing media filenames from stable receipts when readable naming changes", async () => {
  const vault = new MemoryVault();
  const writer = new VaultWriter(vault, { folderPath: "Inbox" });
  const post = { ...POST, media: [{ id: "old", kind: "image" as const, sourceUrl: "https://cdn.example/image.jpg" }] };
  const oldPath = "Inbox/attachments/legacy-hash/image-hash.jpg";
  vault.files.set(oldPath, "existing media");
  const manifest = await writer.plan(post, { existingMediaPaths: { old: oldPath } });
  expect(manifest.attachments[0]).toMatchObject({ path: oldPath, action: "skip" });
  expect(manifest.renderedManagedBlock).toContain(`![[${oldPath}]]`);
});

it("caps UTF-8 filenames while preserving complete emoji without a default sequence", async () => {
  const writer = new VaultWriter(new MemoryVault(), { folderPath: "Inbox" });
  const manifest = await writer.plan({ ...POST, title: "作品😀".repeat(100), author: { id: "one", displayName: "摄影😀".repeat(40) } });
  const filename = manifest.notePath.split("/").at(-1)!;
  expect(new TextEncoder().encode(filename).length).toBeLessThan(255);
  expect(filename).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  expect(filename).toMatch(/\.md$/);
  expect(filename).not.toMatch(/_01\.md$/);
});

it("shows Downloading only during the write and replaces it with a local embed or failure", async () => {
  const vault = new MemoryVault();
  const writer = new VaultWriter(vault, {folderPath:"Inbox"});
  const post = {...POST,media:[{id:"image",kind:"image" as const,sourceUrl:"https://cdn.example/image.jpg"}]};
  const manifest = await writer.plan(post);
  let finish!: (bytes:ArrayBuffer) => void;
  const writing = writer.execute(manifest, post.canonicalUrl, () => new Promise(resolve => {finish = resolve;}));
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const file = vault.getFile(manifest.notePath)!;
  expect(await vault.readText(file)).toContain("Downloading…");
  finish(new ArrayBuffer(3));
  const result = await writing;
  expect(await vault.readText(file)).not.toContain("Downloading");
  expect(await vault.readText(file)).toContain(`![[${manifest.attachments[0]!.path}]]`);
  expect(result.ledger.completion).toBe("complete");
});

it("keeps recovery proof outside managed content so unchanged notes remain reusable", async () => {
  const vault = new MemoryVault();
  const savedAt = "2026-10-19T00:00:00.000Z";
  const writer = new VaultWriter(vault, { folderPath: "Inbox", mediaPolicy: "link_only", now: () => new Date(savedAt) });
  const manifest = await writer.plan(POST);
  await writer.execute(manifest, POST.canonicalUrl, undefined, { recoveryId: "original-write" });
  expect(await writer.recoveryEvidence("original-write", manifest)).toEqual({ savedAt });
  expect(await writer.recoveryEvidence("unrelated-write", manifest)).toBeUndefined();
  const replay = await writer.plan(POST);
  expect(replay.action).toBe("skip");
  await writer.execute(replay, POST.canonicalUrl, undefined, { recoveryId: "reuse-only" });
  expect(await writer.recoveryEvidence("reuse-only", replay)).toBeUndefined();
  expect(await writer.recoveryEvidence("original-write", manifest)).toEqual({ savedAt });
});

it("only confirms complete physical recovery evidence and performs no writes while inspecting it", async () => {
  const vault = new MemoryVault();
  const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image.png" }] };
  const writer = new VaultWriter(vault, { folderPath: "Inbox", mediaPolicy: "download_all" });
  const manifest = await writer.plan(post);
  await writer.execute(manifest, post.canonicalUrl, async () => new ArrayBuffer(3), { recoveryId: "write-proof" });
  const writeText = vi.spyOn(vault, "modifyText"), binary = vi.spyOn(vault, "createBinary");
  expect(await writer.confirmRecovery("write-proof", manifest, post.canonicalUrl)).toMatchObject({ recovered: true,
    ledger: { completion: "complete" }, attachments: [{ status: "saved" }] });
  expect(await writer.confirmRecovery("other-proof", manifest, post.canonicalUrl)).toBeUndefined();
  vault.files.delete(manifest.attachments[0]!.path);
  expect(await writer.confirmRecovery("write-proof", manifest, post.canonicalUrl)).toBeUndefined();
  expect(writeText).not.toHaveBeenCalled();
  expect(binary).not.toHaveBeenCalled();
});

it("confirms cross-task reuse only with a complete receipt and matching physical files", async () => {
  const vault = new MemoryVault();
  const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image.png" }] };
  const writer = new VaultWriter(vault, { folderPath: "Inbox", mediaPolicy: "download_all" });
  const original = await writer.plan(post);
  const written = await writer.execute(original, post.canonicalUrl, async () => new ArrayBuffer(3), { recoveryId: "another-task" });
  const modify = vi.spyOn(vault, "modifyText"), binary = vi.spyOn(vault, "createBinary");
  expect(await writer.confirmRecovery("original-task", original, post.canonicalUrl)).toBeUndefined();
  expect(await writer.confirmReuse(original, written.ledger)).toMatchObject({ manifest: { action: "skip" }, attachments: [{ status: "skipped" }] });
  expect(await writer.confirmReuse(original, { ...written.ledger, completion: "partial" })).toBeUndefined();
  expect(await writer.confirmReuse(original, { ...written.ledger, notePath: "Other/post.md" })).toBeUndefined();
  vault.files.delete(original.attachments[0]!.path);
  expect(await writer.confirmReuse(original, written.ledger)).toBeUndefined();
  expect(modify).not.toHaveBeenCalled(); expect(binary).not.toHaveBeenCalled();
});

it("keeps per-media failure facts distinct from text while preserving successful siblings", async () => {
  const vault = new MemoryVault(), writer = new VaultWriter(vault, { folderPath: "Research" });
  const post = { ...POST, media: ["saved", "expired", "temporary"].map(id => ({ id, kind: "image" as const, sourceUrl: `https://cdn.example/${id}.jpg` })) };
  const manifest = await writer.plan(post);
  const result = await writer.execute(manifest, post.canonicalUrl, async id => {
    if (id === "expired") throw MediaDownloadError.http(403);
    if (id === "temporary") throw new Error("Local expired handle; HTTP 403 is only text in this diagnostic");
    return new ArrayBuffer(1);
  });
  expect(result.attachments).toEqual([
    expect.objectContaining({ mediaId: "saved", status: "saved" }),
    expect.objectContaining({ mediaId: "expired", status: "failed", failureKind: "source_expired" }),
    expect.objectContaining({ mediaId: "temporary", status: "failed", failureKind: "retryable" })
  ]);
  expect(result.ledger.completion).toBe("partial");
  const retry = await writer.plan(post);
  expect(retry.attachments.find(item => item.mediaId === "saved")?.action).toBe("skip");
});

it("does not downgrade a confirmed desktop import when temporary download cleanup fails", async () => {
  const vault = new MemoryVault();
  const importMediaFile = vi.fn(async (path: string) => { vault.files.set(path, "<binary>"); return { path }; });
  const writer = new VaultWriter(Object.assign(vault, { importMediaFile }), { folderPath: "Research" });
  const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image.png" }] };
  const manifest = await writer.plan(post);
  const cleanup = vi.fn(async () => { throw new Error("temporary file locked"); });
  const result = await writer.execute(manifest, post.canonicalUrl, async () => ({ kind: "file", path: "/temporary/download", sizeBytes: 1, cleanup }),
    { recoveryId: "original-intent" });
  expect(result.attachments[0]).toMatchObject({ mediaId: "image", status: "saved" });
  expect(result.ledger.completion).toBe("complete");
  expect(importMediaFile).toHaveBeenCalledTimes(1); expect(cleanup).toHaveBeenCalledTimes(1);
  expect(await writer.confirmRecovery("original-intent", manifest, post.canonicalUrl)).toBeDefined();
});

it("persists exact attachment byte evidence before publishing and performs read-only verification", async () => {
  const vault = new MemoryVault();
  const fingerprint = { sizeBytes: 1, sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a" };
  const readFingerprint = vi.fn(async () => fingerprint);
  const writer = new VaultWriter(Object.assign(vault, { fingerprintMedia: readFingerprint }), { folderPath: "Research" });
  const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image.png" }] };
  const manifest = await writer.plan(post);
  const publish = vi.spyOn(vault, "createBinary");
  const prepare = vi.fn(async () => { expect(publish).not.toHaveBeenCalled(); });
  await writer.execute(manifest, post.canonicalUrl, async () => new Uint8Array([1]).buffer, { recoveryId: "intent", prepareMediaPublication: prepare });
  const evidence = { mediaId: "image", path: manifest.attachments[0]!.path, ...fingerprint };
  expect(prepare).toHaveBeenCalledWith(evidence);
  const before = publish.mock.calls.length;
  expect(await writer.verifyMediaPublications(manifest, [evidence])).toEqual(["image"]);
  readFingerprint.mockResolvedValueOnce({ ...fingerprint, sha256: "0".repeat(64) });
  expect(await writer.verifyMediaPublications(manifest, [evidence])).toEqual([]);
  expect(await writer.verifyMediaPublications(manifest, [{ ...evidence, path: "Other/file.png" }])).toEqual([]);
  expect(publish).toHaveBeenCalledTimes(before);
});

it("does not publish attachment bytes when its durable publication intent cannot be saved", async () => {
  const vault = new MemoryVault(), writer = new VaultWriter(vault, { folderPath: "Research" });
  const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image.png" }] };
  const publish = vi.spyOn(vault, "createBinary");
  const manifest = await writer.plan(post);
  const result = await writer.execute(manifest, post.canonicalUrl, async () => new ArrayBuffer(1),
    { recoveryId: "intent", prepareMediaPublication: async () => { throw new Error("intent disk failure"); } });
  expect(result.ledger.completion).toBe("partial");
  expect(publish).not.toHaveBeenCalled();
});

it.each(["changed-body", "changed-bytes", "matching"] as const)("reconciles interrupted publication only with original body and byte proof: %s", async condition => {
  const vault = new MemoryVault();
  const digest = { sizeBytes: 1, sha256: "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a" };
  const writer = new VaultWriter(Object.assign(vault, { fingerprintMedia: async () => condition === "changed-bytes" ? { ...digest, sha256: "0".repeat(64) } : digest }),
    { folderPath: "Research" });
  const post = { ...POST, media: ["one", "two"].map(id => ({ id, kind: "image" as const, sourceUrl: `https://cdn.example/${id}.png` })) };
  const manifest = await writer.plan(post);
  const publish = vi.spyOn(vault, "createBinary").mockImplementation(async path => { vault.files.set(path, "<binary>"); throw new Error("acknowledgement lost"); });
  const evidence: import("@/vault/MediaFingerprint").MediaPublicationIntent[] = [];
  await expect(writer.execute(manifest, post.canonicalUrl, async () => new Uint8Array([1]).buffer,
    { recoveryId: "original", prepareMediaPublication: async item => { evidence.push(item); } })).rejects.toMatchObject({ serverCode: "WRITE_REQUIRES_RECONCILIATION" });
  const text = vault.files.get(manifest.notePath)! + "\nKeep my own notes\n";
  vault.files.set(manifest.notePath, condition === "changed-body" ? text.replace("Original summary", "User changed the body") : text);
  const before = vault.files.get(manifest.notePath);
  const result = await writer.reconcilePublications("original", manifest, evidence, post.canonicalUrl);
  expect(publish).toHaveBeenCalledTimes(1);
  if (condition !== "matching") {
    expect(result).toBeUndefined(); expect(vault.files.get(manifest.notePath)).toBe(before); return;
  }
  expect(result).toMatchObject({ reconciled: true, ledger: { completion: "partial" }, attachments: [
    { mediaId: "one", status: "saved" }, { mediaId: "two", status: "failed" }
  ] });
  expect(vault.files.get(manifest.notePath)).toContain("Keep my own notes");
  const replay = await writer.reconcilePublications("original", manifest, evidence, post.canonicalUrl);
  expect(replay?.ledger.writtenAt).toBe(result?.ledger.writtenAt);
});

it.each(["create", "frontmatter", "identity", "final-marker"])("retains unknown outcome when %s acknowledgement fails after a note mutation", async stage => {
  const vault = new MemoryVault();
  const writer = new VaultWriter(vault, { folderPath: "Research" });
  const manifest = await writer.plan(POST);
  const failure = new Error("host acknowledgement lost");
  if (stage === "create") vi.spyOn(vault, "createText").mockImplementation(async (path, text) => { vault.files.set(path, text); throw failure; });
  if (stage === "frontmatter") vi.spyOn(vault, "updateFrontmatter").mockRejectedValue(failure);
  if (stage === "identity") vi.spyOn(vault, "recordNoteIdentity").mockRejectedValue(failure);
  if (stage === "final-marker") vi.spyOn(vault, "modifyText").mockImplementation(async (file, text) => { vault.files.set(file.path, text); throw failure; });
  await expect(writer.execute(manifest, POST.canonicalUrl, undefined, { recoveryId: "original" }))
    .rejects.toMatchObject({ serverCode: "WRITE_REQUIRES_RECONCILIATION" });
  expect(vault.files.size).toBe(1);
  expect(vault.files.get(manifest.notePath)).toContain("agentlens:write:original");
  if (stage === "final-marker") expect(await writer.confirmRecovery("original", manifest, POST.canonicalUrl)).toMatchObject({ recovered: true });
});

it("keeps pre-publication note path conflicts distinct from unknown physical writes", async () => {
  const vault = new MemoryVault();
  const writer = new VaultWriter(vault, { folderPath: "Research" });
  const manifest = await writer.plan(POST);
  vault.files.set(manifest.notePath, "User-owned note");
  await expect(writer.execute(manifest, POST.canonicalUrl, undefined, { recoveryId: "original" }))
    .rejects.toMatchObject({ code: "vault_conflict" });
  expect(vault.files.get(manifest.notePath)).toBe("User-owned note");
});

it("recovers an unprepared original note only with explicit stage evidence and no unexplained media files", async () => {
  const vault = new MemoryVault();
  const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image" }] };
  const writer = new VaultWriter(vault, { folderPath: "Research", mediaPolicy: "download_all" });
  const manifest = await writer.plan(post);
  const publish = vault.createText.bind(vault);
  vi.spyOn(vault, "createText").mockImplementation(async (path, text) => { await publish(path, text); throw new Error("lost acknowledgement"); });
  await expect(writer.execute(manifest, post.canonicalUrl, async () => new ArrayBuffer(1), { recoveryId: "original" })).rejects.toThrow();
  const original = vault.files.get(manifest.notePath)!;
  const recover = () => writer.reconcilePublications("original", manifest, [], post.canonicalUrl, { recoverUnpreparedNote: true });
  expect(await writer.reconcilePublications("original", manifest, [], post.canonicalUrl)).toBeUndefined();
  vault.files.set(manifest.attachments[0]!.path, "unproven bytes");
  expect(await recover()).toBeUndefined();
  vault.files.delete(manifest.attachments[0]!.path);
  vault.files.set(manifest.notePath, original.replace("Original summary", "User changed source block"));
  expect(await recover()).toBeUndefined();
  vault.files.set(manifest.notePath, original + "\nUser notes stay\n");
  expect(await recover()).toMatchObject({ recovered: true, reconciled: true, attachmentsNotStarted: true,
    ledger: { completion: "partial" }, attachments: [{ mediaId: "image", status: "failed" }] });
  expect(vault.frontmatter.get(manifest.notePath)).toMatchObject(manifest.frontmatter);
  expect(vault.keysByPath.get(manifest.notePath)).toBe(manifest.contentKey);
  expect(vault.files.get(manifest.notePath)).toContain("User notes stay");
});

it("does not start attachments before note-stage persistence succeeds", async () => {
  const vault = new MemoryVault();
  const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image" }] };
  const writer = new VaultWriter(vault, { folderPath: "Research", mediaPolicy: "download_all" });
  const download = vi.fn(async () => new ArrayBuffer(1));
  await expect(writer.execute(await writer.plan(post), post.canonicalUrl, download, {
    recoveryId: "original", notePrepared: async () => { throw new Error("intent persistence unavailable"); },
  })).rejects.toMatchObject({ serverCode: "WRITE_REQUIRES_RECONCILIATION" });
  expect(download).not.toHaveBeenCalled();
});

it("cleans late downloaded files without publishing them or finalizing notes after ownership changes", async () => {
  const vault = new MemoryVault();
  const post = { ...POST, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image" }] };
  const writer = new VaultWriter(vault, { folderPath: "Research", mediaPolicy: "download_all" });
  let current = true;
  const cleanup = vi.fn(async () => {}), publish = vi.spyOn(vault, "createBinary"), modify = vi.spyOn(vault, "modifyText");
  await expect(writer.execute(await writer.plan(post), post.canonicalUrl, async () => {
    current = false;
    return { kind: "file" as const, path: "/tmp/temporary-media", sizeBytes: 1, cleanup };
  }, { recoveryId: "original", assertCurrent: () => { if (!current) throw new Error("Account changed"); } }))
    .rejects.toMatchObject({ serverCode: "WRITE_REQUIRES_RECONCILIATION" });
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();
  expect(modify).not.toHaveBeenCalled();
  expect(vault.files.size).toBe(1);
});

it("checks ownership again after folder preparation and stops before creating the note", async () => {
  const vault = new MemoryVault();
  let current = true;
  vi.spyOn(vault, "ensureFolder").mockImplementation(async () => { current = false; });
  const writer = new VaultWriter(vault, { folderPath: "Research" });
  await expect(writer.execute(await writer.plan(POST), POST.canonicalUrl, undefined, {
    recoveryId: "original", assertCurrent: () => { if (!current) throw new Error("Account changed"); },
  })).rejects.toThrow("Account changed");
  expect(vault.files.size).toBe(0);
});
