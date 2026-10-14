import { RemoteImageContext } from "./workbench/RemoteImage";
import { loadRemoteImage } from "../runtime/loadRemoteImage";
import { compactPopoutChrome } from "./workbench/popoutChrome";
import { HostDocumentContext } from "./workbench/HostDocument";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { Component, MarkdownRenderer, ItemView, Notice, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { WorkbenchApp, type WorkbenchDefaults, type WorkbenchTab } from "./WorkbenchApp";
import type { AgentLensWorkbenchPort } from "../workbench/ports";

export const WORKBENCH_VIEW_TYPE = "agentlens-workbench";

export class WorkbenchView extends ItemView {
  private root: Root | undefined;
  private hasDraft = false;
  private restoreChrome: (() => void) | undefined;

  private initialTab: WorkbenchTab = "single";
  private initialUrl?: string | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly service: AgentLensWorkbenchPort,
    private readonly defaults?: WorkbenchDefaults | undefined
  ) { super(leaf); }

  getViewType(): string { return WORKBENCH_VIEW_TYPE; }
  getDisplayText(): string { return "AgentLens"; }
  getIcon(): string { return "file-down"; }

  configure(tab: WorkbenchTab, url?: string): void {
    if (this.initialTab === tab && this.initialUrl === url) return;
    if (!this.confirmClose()) return;
    this.initialTab = tab;
    this.initialUrl = url;
    this.renderWorkbench();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("agentlens-workbench-view", "agentlens-workbench-root");
    this.root = createRoot(this.contentEl);
    this.renderWorkbench();
  }

  refreshHost(): void {
    this.restoreChrome?.();
    this.restoreChrome = compactPopoutChrome(this.contentEl.ownerDocument);
    this.renderWorkbench();
  }

  private readonly refreshFolders = (): void => { this.renderWorkbench(); };

  private renderWorkbench(): void {

    const folderCounts: Record<string, number> = {};
    for (const file of this.app.vault.getFiles()) {
      const parts = file.path.split('/');
      for (let depth = 1; depth < parts.length; depth++) {
        const path = parts.slice(0, depth).join('/');
        folderCounts[path] = (folderCounts[path] ?? 0) + 1;
      }
    }
    this.root?.render(
      <RemoteImageContext.Provider value={loadRemoteImage}><HostDocumentContext.Provider value={this.contentEl.ownerDocument}><WorkbenchApp
        key={`${this.initialTab}:${this.initialUrl ?? ""}`}
        initialTab={this.initialTab}
        locale={this.defaults?.locale}
        initialUrl={this.initialUrl}
        service={this.service}
        defaults={this.defaults}
        vaultName={this.app.vault.getName()}
        vaultFolderCounts={folderCounts}
        onRefreshFolders={this.refreshFolders}
        vaultFolders={this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder && file.path !== "/").map((folder) => folder.path)}
        renderMarkdown={(markdown, element, sourcePath) => {
          const component = new Component();
          component.load();
          const container = element.ownerDocument.createElement("div");
          element.replaceChildren(container);
          void MarkdownRenderer.render(this.app, markdown, container, sourcePath, component).catch(() => {
            container.textContent = markdown;
          });
          return () => { component.unload(); container.remove(); };
        }}
        onClose={() => this.requestClose()}
        onDirtyStateChange={(dirty) => { this.hasDraft = dirty; }}
        onOpenFolder={(path) => {
          const folder = this.app.vault.getAbstractFileByPath(path || "/");
          if (!(folder instanceof TFolder)) {
            new Notice("This destination folder does not exist yet. It will be created when a note is saved.");
            return;
          }
          const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
          // File Explorer's reveal method is optional across hosts and core-plugin settings.
          const view = leaf?.view as ({ revealInFolder?: (folder: TFolder) => void | Promise<void> }) | undefined;
          if (!leaf || typeof view?.revealInFolder !== "function") {
            new Notice("Enable Obsidian's Files core plugin to reveal this folder.");
            return;
          }
          void Promise.resolve().then(async () => {
            await view.revealInFolder?.(folder);
            await this.app.workspace.revealLeaf(leaf);
          }).catch(() => { new Notice("Unable to reveal this folder in Obsidian."); });
        }}
        onOpenNote={(path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            const leaf = this.app.workspace.getLeavesOfType("markdown").find(candidate => candidate !== this.leaf)
              ?? this.app.workspace.getLeaf("split");
            void leaf.openFile(file, { active: true });
          }
        }}
      /></HostDocumentContext.Provider></RemoteImageContext.Provider>
    );
  }

  async onClose(): Promise<void> {
    this.service.cancelManualSaves?.();
    this.restoreChrome?.();
    this.restoreChrome = undefined;
    void this.service?.cancelPendingSignIn?.().catch(() => undefined);
    this.root?.unmount();
    this.root = undefined;
    this.contentEl.empty();
  }

  // View.close is a host lifecycle method called by WorkspaceLeaf.detach.
  // Keep the user action separate to avoid recursively detaching the same leaf.
  private requestClose(): void {
    if (!this.service.isManualSaving?.() && !this.confirmClose()) return;
    this.service.cancelManualSaves?.();
    this.leaf.detach();
  }

  private confirmClose(): boolean {
    return !this.hasDraft || (this.contentEl.ownerDocument.defaultView ?? window).confirm("Discard unsaved AgentLens drafts and close the workbench? Choose Cancel to keep the drafts open.");
  }
}
