import { describe, expect, it, vi } from "vitest";
import { FileSystemAdapter, TFile, type App } from "obsidian";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObsidianVaultPort } from "@/vault/ObsidianVaultPort";
import type { PluginStateStore } from "@/runtime/PluginStateStore";

function fixture(content: string, properties: Record<string, unknown>) {
  const file = new TFile(); file.path = "Inbox/moved.md";
  const app = {
    vault: { getAbstractFileByPath: () => file, getMarkdownFiles: () => [file], read: async () => content, cachedRead: async () => content },
    metadataCache: { getFileCache: () => ({ frontmatter: properties }) },
    fileManager: { processFrontMatter: vi.fn(async (_file: unknown, update: (value: Record<string, unknown>) => void) => update(properties)) }
  } as unknown as App;
  return { port: new ObsidianVaultPort(app), file, properties };
}

it("recognizes a published desktop attachment without waiting on a renderer timer", async () => {
  const vault = await mkdtemp(join(tmpdir(), "agentlens-registration-"));
  const source = join(vault, "source.part");
  const bytes = new Uint8Array([1, 2, 3]);
  const attachment = new TFile();
  attachment.path = "attachment.jpg";
  const getAbstractFileByPath = vi.fn().mockReturnValueOnce(null).mockReturnValue(attachment);
  const adapter = Object.assign(new FileSystemAdapter(), { getBasePath: () => vault });
  const port = new ObsidianVaultPort({ vault: { adapter, getAbstractFileByPath } } as unknown as App);
  const rendererTimer = vi.spyOn(window, "setTimeout");
  try {
    await writeFile(source, bytes);
    await expect(port.importMediaFile(attachment.path, {
      kind: "file", path: source, sizeBytes: bytes.length, sha256: "", cleanup: async () => {}
    })).resolves.toBe(attachment);
    expect(await readFile(join(vault, attachment.path))).toEqual(Buffer.from(bytes));
    expect(rendererTimer.mock.calls.some(([, milliseconds]) => milliseconds === 50)).toBe(false);
  } finally {
    rendererTimer.mockRestore();
    await rm(vault, { recursive: true, force: true });
  }
});

describe("Vault template metadata migration", () => {
  it("finds a moved note by hidden stable identity after public properties are cleaned", async () => {
    const f = fixture("<!-- agentlens:identity:xiaohongshu%3Apost-1 -->\n<!-- agentlens:metadata:%7B%7D -->", { agentlens_key: "xiaohongshu:post-1", agentlens_fetch_id: "old", custom: "keep" });
    await f.port.updateFrontmatter(f.file, { Platform: "xiaohongshu", tags: ["photography"] });
    expect(f.properties).toEqual({ Platform: "xiaohongshu", tags: ["photography"], custom: "keep" });
    expect(await f.port.findByAgentLensKey("Inbox", "xiaohongshu:post-1", "https://example.com/post-1")).toBe(f.file);
    expect(await f.port.findByAgentLensKey("Inbox", "xiaohongshu:another", "https://example.com/another")).toBeNull();
  });

  it("removes legacy internal properties after writing public source properties", async () => {
    const f = fixture("<!-- agentlens:identity:xiaohongshu%3Apost-1 -->", { agentlens_key: "xiaohongshu:post-1", agentlens_fetch_id: "old", custom: "keep" });
    await f.port.updateFrontmatter(f.file, { Platform: "xiaohongshu" });
    expect(f.properties.agentlens_fetch_id).toBeUndefined();
    expect(await f.port.findByAgentLensKey("Inbox", "xiaohongshu:post-1", "https://example.com/post-1")).toBe(f.file);
  });

  it("does not treat another indexed note with the same source URL as this post", async () => {
    const owned = new TFile(); owned.path = "Inbox/owned.md";
    const moved = new TFile(); moved.path = "Inbox/moved.md";
    const sourceUrl = "https://example.com/post-1";
    const files = new Map([[owned.path, owned], [moved.path, moved]]);
    const state = { noteKeysByPath: {
      [owned.path]: "xiaohongshu:another-post",
      "Inbox/old-path.md": "xiaohongshu:post-1"
    } };
    const app = {
      vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        getMarkdownFiles: () => [owned, moved], cachedRead: async () => "# Note\n" },
      metadataCache: { getFileCache: () => ({ frontmatter: { Platform: "xiaohongshu", Source_url: sourceUrl } }) }
    } as unknown as App;
    const store = { load: async () => state, update: async (mutate: (value: typeof state) => void) => { mutate(state); } } as unknown as PluginStateStore;
    const port = new ObsidianVaultPort(app, store);

    expect(await port.findByAgentLensKey("Inbox", "xiaohongshu:post-1", sourceUrl)).toBe(moved);
    await port.recordNoteIdentity(moved, "xiaohongshu:post-1");
    expect(state.noteKeysByPath[moved.path]).toBe("xiaohongshu:post-1");
  });

  it("rejects a reused indexed path when its source URL changed", async () => {
    const file = new TFile(); file.path = "Inbox/reused.md";
    const app = {
      vault: { getAbstractFileByPath: () => file, getMarkdownFiles: () => [file],
        cachedRead: async () => "---\nSource_url: https://example.com/other\nPlatform: xiaohongshu\n---\n# User note\n" },
      metadataCache: { getFileCache: () => ({ frontmatter: { Platform: "xiaohongshu", Source_url: "https://example.com/other" } }) }
    } as unknown as App;
    const store = { load: async () => ({ noteKeysByPath: { [file.path]: "xiaohongshu:post-1" } }) } as unknown as PluginStateStore;
    const port = new ObsidianVaultPort(app, store);
    expect(await port.findByAgentLensKey("Inbox", "xiaohongshu:post-1", "https://example.com/post-1")).toBeNull();
  });
});
