import { expect, it, vi } from "vitest";
import { compactPopoutChrome, WORKBENCH_POPOUT_SIZE } from "@/ui/workbench/popoutChrome";

it("hides native controls only in a dedicated pop-out and restores them for other tabs and cleanup", async () => {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const setWindowButtonVisibility = vi.fn();
  Object.assign(frame.contentWindow!, {electronWindow: {setWindowButtonVisibility}});
  doc.body.classList.add("is-popout-window");
  doc.body.innerHTML = '<div class="workspace-leaf-content" data-type="agentlens-workbench"></div>';
  const restore = compactPopoutChrome(doc);
  expect(doc.body).toHaveClass("agentlens-frameless");
  expect(setWindowButtonVisibility).toHaveBeenLastCalledWith(false);
  const other = doc.createElement("div");
  other.className = "workspace-leaf-content";
  other.dataset.type = "markdown";
  doc.body.appendChild(other);
  await vi.waitFor(() => expect(doc.body).not.toHaveClass("agentlens-frameless"));
  expect(setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
  other.remove();
  await vi.waitFor(() => expect(doc.body).toHaveClass("agentlens-frameless"));
  restore();
  expect(setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
  expect(doc.body).not.toHaveClass("agentlens-frameless");
  frame.remove();
});

it("locks the dedicated pop-out to a fixed width while allowing height changes to restore later", async () => {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const electronWindow = {
    setWindowButtonVisibility: vi.fn(),
    getSize: vi.fn(() => [800, 900] as [number, number]),
    setSize: vi.fn(),
    getMinimumSize: vi.fn(() => [100, 100] as [number, number]),
    getMaximumSize: vi.fn(() => [2000, 2000] as [number, number]),
    setMinimumSize: vi.fn(),
    setMaximumSize: vi.fn(),
    isMaximizable: vi.fn(() => true),
    setMaximizable: vi.fn()
  };
  Object.assign(frame.contentWindow!, { electronWindow });
  doc.body.classList.add("is-popout-window");
  doc.body.innerHTML = '<div class="workspace-leaf-content" data-type="agentlens-workbench"></div>';
  const restore = compactPopoutChrome(doc);
  expect(electronWindow.setSize).toHaveBeenCalledWith(WORKBENCH_POPOUT_SIZE.width, 900);
  expect(electronWindow.setMinimumSize).toHaveBeenCalledWith(WORKBENCH_POPOUT_SIZE.width, 320);
  expect(electronWindow.setMaximumSize).toHaveBeenCalledWith(WORKBENCH_POPOUT_SIZE.width, 2000);
  expect(electronWindow.setMaximizable).toHaveBeenCalledWith(false);
  electronWindow.getSize.mockReturnValue([900, 880]);
  frame.contentWindow!.dispatchEvent(new Event("resize"));
  expect(electronWindow.setSize).toHaveBeenLastCalledWith(WORKBENCH_POPOUT_SIZE.width, 880);
  const other = doc.createElement("div");
  other.className = "workspace-leaf-content";
  other.dataset.type = "markdown";
  doc.body.appendChild(other);
  await vi.waitFor(() => expect(electronWindow.setMinimumSize).toHaveBeenCalledWith(100, 100));
  expect(electronWindow.setMaximumSize).toHaveBeenCalledWith(2000, 2000);
  expect(electronWindow.setMaximizable).toHaveBeenCalledWith(true);
  restore();
  frame.remove();
});
