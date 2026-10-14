import { normalizePath, TFile, type App } from "obsidian";
import type { VaultFileRef, VaultPort } from "./VaultWriter";
import type { PluginStateStore } from "../runtime/PluginStateStore";

export class ObsidianVaultPort implements VaultPort {
  constructor(private readonly app: App, private readonly stateStore?: PluginStateStore) {}

  getFile(path: string): VaultFileRef | null {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  }

  async readText(file: VaultFileRef): Promise<string> {
    return this.app.vault.read(this.requireFile(file));
  }

  async createText(path: string, content: string): Promise<VaultFileRef> {
    return this.app.vault.create(normalizePath(path), content);
  }

  async modifyText(file: VaultFileRef, content: string): Promise<void> {
    await this.app.vault.modify(this.requireFile(file), content);
  }

  async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    let current = "";
    for (const segment of normalized.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  async updateFrontmatter(file: VaultFileRef, values: Readonly<Record<string, unknown>>): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.requireFile(file), (frontmatter) => {
      // Source_url and Platform identify marker-free notes; legacy identity
      // properties can be removed after a write has supplied both fields.
      for (const key of ["agentlens_key", "agentlens_content_id", "agentlens_fetch_id", "agentlens_effective_post_key", "agentlens_client", "canonical_url", "creator_handle", "has_transcript", "agentlens_template"]) delete frontmatter[key];
      for (const [key, value] of Object.entries(values)) frontmatter[key] = value;
    });
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<VaultFileRef> {
    return this.app.vault.createBinary(normalizePath(path), data);
  }

  async findByAgentLensKey(folderPath: string, contentKey: string, sourceUrl: string): Promise<VaultFileRef | null> {
    const prefix = `${normalizePath(folderPath).replace(/\/$/, "")}/`;
    const indexedPaths = (await this.stateStore?.load())?.noteKeysByPath ?? {};
    const candidates = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .sort((left, right) => left.path.localeCompare(right.path));
    for (const file of candidates) {
      if (await this.matchesAgentLensKey(file, contentKey, sourceUrl, indexedPaths)) return file;
    }
    return null;
  }

  async matchesAgentLensKey(file: VaultFileRef, contentKey: string, sourceUrl: string,
    knownPaths?: Record<string, string>): Promise<boolean> {
    const resolved = this.requireFile(file);
    const indexedPaths = knownPaths ?? (await this.stateStore?.load())?.noteKeysByPath;
    const indexed = indexedPaths?.[file.path];
    if (indexed && indexed !== contentKey) return false;
    const frontmatter = this.app.metadataCache.getFileCache(resolved)?.frontmatter;
    const content = await this.app.vault.cachedRead(resolved);
    if (frontmatter?.agentlens_effective_post_key === contentKey || frontmatter?.agentlens_key === contentKey) return true;
    if (content.includes(`<!-- agentlens:identity:${encodeURIComponent(contentKey)} -->`)) return true;
    const platformKey = contentKey.slice(0, contentKey.indexOf(":"));
    const sourceMatches = (frontmatter?.Source_url === sourceUrl
      && String(frontmatter.Platform ?? "").trim().toLowerCase() === platformKey)
      || (yamlScalar(content, "Source_url") === sourceUrl
      && yamlScalar(content, "Platform")?.toLowerCase() === platformKey);
    if (indexed) return sourceMatches;
    // A source URL alone must not make a user-owned note writable. Use it only
    // to rediscover an indexed AgentLens note that was moved out of its old path.
    if (this.stateStore && !Object.entries(indexedPaths ?? {}).some(([path, key]) =>
      key === contentKey && !this.app.vault.getAbstractFileByPath(path))) return false;
    return sourceMatches;
  }

  async recordNoteIdentity(file: VaultFileRef, contentKey: string): Promise<void> {
    await this.stateStore?.update((state) => {
      state.noteKeysByPath ??= {};
      state.noteKeysByPath[file.path] = contentKey;
    });
  }

  private requireFile(file: VaultFileRef): TFile {
    const resolved = this.app.vault.getAbstractFileByPath(normalizePath(file.path));
    if (!(resolved instanceof TFile)) throw new Error(`Vault file not found: ${file.path}`);
    return resolved;
  }
}

function yamlScalar(content: string, field: string): string | null {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const match = content.slice(4, end).match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  if (!match) return null;
  const value = match[1]!.trim();
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\"/g, '"')
    : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
}
