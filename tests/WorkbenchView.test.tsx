import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import type { AgentLensWorkbenchPort } from "@/workbench/ports";
vi.mock("@/ui/WorkbenchApp", () => ({ WorkbenchApp: (props: any) => <div>
  <span>{props.initialTab}</span>
  <button onClick={props.onClose}>Close workbench</button>
  <button onClick={() => props.onOpenNote("note.md")}>Open saved note</button>
  <button onClick={() => props.onOpenFolder("Inbox")}>Reveal folder</button>
</div> }));
import { WorkbenchView } from "@/ui/WorkbenchView";

describe("native workbench view", () => {
  it("detaches once and lets the host close lifecycle unmount the workbench", async () => {
    const cancelPendingSignIn = vi.fn(async () => {});
    const app = { vault: { on: vi.fn(), getFiles: () => [], getName: () => "Test", getAllLoadedFiles: () => [] } };
    let view: WorkbenchView;
    const leaf = { app, detach: vi.fn(() => (view as unknown as { close(): Promise<void> }).close()) };
    view = new WorkbenchView(leaf as unknown as WorkspaceLeaf, { cancelPendingSignIn } as unknown as AgentLensWorkbenchPort);
    document.body.appendChild(view.contentEl);
    await act(() => view.onOpen());
    await act(async () => { fireEvent.click(screen.getByText("Close workbench")); });
    expect(leaf.detach).toHaveBeenCalledTimes(1);
    expect(cancelPendingSignIn).toHaveBeenCalledTimes(1);
    expect(view.contentEl).toBeEmptyDOMElement();
    view.contentEl.remove();
  });

  it("keeps its pane mounted while notes and folders open in the host", async () => {
    const rootSplit = {};
    const noteLeaf = {getRoot: () => rootSplit, openFile: vi.fn(async () => {})};
    const popoutNote = {getRoot: () => ({}), openFile: vi.fn(async () => {})};
    const fileLeaf = {view: {revealInFolder: vi.fn(async () => {})}};
    const app = {vault: {on: vi.fn(), getFiles: () => [], getName: () => "Test", getAllLoadedFiles: () => [],
      getAbstractFileByPath: (path: string) => path === "note.md" ? Object.assign(new TFile(), {path}) : Object.assign(new TFolder(), {path})},
      workspace: {rootSplit, getLeavesOfType: (type: string) => type === "markdown" ? [popoutNote, noteLeaf] : [fileLeaf],
        revealLeaf: vi.fn(async () => {}), getLeaf: vi.fn()}};
    const leaf = {app, detach: vi.fn()};
    const view = new WorkbenchView(leaf as unknown as WorkspaceLeaf, {cancelPendingSignIn: async () => {}} as AgentLensWorkbenchPort);
    document.body.appendChild(view.contentEl);
    await act(() => view.onOpen());
    expect(view).toBeInstanceOf(ItemView);
    expect(document.querySelector('.modal-container')).toBeNull();
    await act(async () => {fireEvent.click(screen.getByText("Open saved note"));});
    expect(noteLeaf.openFile).toHaveBeenCalledWith(expect.objectContaining({path: "note.md"}), {active: true});
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(noteLeaf);
    expect(popoutNote.openFile).not.toHaveBeenCalled();
    await act(async () => {fireEvent.click(screen.getByText("Reveal folder"));});
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(fileLeaf);
    expect(leaf.detach).not.toHaveBeenCalled();
    expect(screen.getByText("Open saved note")).toBeVisible();
    await act(() => view.onClose());
    view.contentEl.remove();
  });

  it.each(["empty", "graph"])("opens saved notes in the main workspace when it only has a %s tab", async type => {
    const rootSplit = {};
    const mainTabs = {};
    const mainLeaf = {parent: mainTabs, view: {getViewType: () => type}, openFile: vi.fn(async () => {})};
    const newLeaf = {openFile: vi.fn(async () => {})};
    const workspace = {
      rootSplit,
      getLeavesOfType: vi.fn(() => []),
      getMostRecentLeaf: vi.fn(() => mainLeaf),
      createLeafInParent: vi.fn(() => newLeaf),
      revealLeaf: vi.fn(async () => {})
    };
    const file = Object.assign(new TFile(), {path: "note.md"});
    const app = {workspace, vault: {on: vi.fn(), getFiles: () => [], getName: () => "Test",
      getAllLoadedFiles: () => [], getAbstractFileByPath: () => file}};
    const view = new WorkbenchView({app} as unknown as WorkspaceLeaf, {} as AgentLensWorkbenchPort);
    document.body.appendChild(view.contentEl);
    await act(() => view.onOpen());
    await act(async () => {fireEvent.click(screen.getByText("Open saved note"));});
    expect(workspace.getMostRecentLeaf).toHaveBeenCalledWith(rootSplit);
    if (type === "empty") expect(workspace.createLeafInParent).not.toHaveBeenCalled();
    else expect(workspace.createLeafInParent).toHaveBeenCalledWith(mainTabs, 0);
    const target = type === "empty" ? mainLeaf : newLeaf;
    expect(target.openFile).toHaveBeenCalledWith(file, {active: true});
    expect(workspace.revealLeaf).toHaveBeenCalledWith(target);
    await act(() => view.onClose());
    view.contentEl.remove();
  });
  it("caches folder counts until a Vault event invalidates them", async () => {
    const handlers = new Map<string, () => void>();
    const getFiles = vi.fn(() => [Object.assign(new TFile(), { path: "Inbox/note.md" })]);
    const app = { vault: { on: (event: string, handler: () => void) => { handlers.set(event, handler); },
      getFiles, getName: () => "Test", getAllLoadedFiles: () => [] } };
    const view = new WorkbenchView({app} as unknown as WorkspaceLeaf, {} as AgentLensWorkbenchPort);
    await act(() => view.onOpen());
    await act(async () => { view.configure("bulk"); });
    expect(getFiles).toHaveBeenCalledTimes(1);
    handlers.get("rename")!();
    await act(async () => { view.configure("single"); });
    expect(getFiles).toHaveBeenCalledTimes(2);
    await act(() => view.onClose());
  });

});
