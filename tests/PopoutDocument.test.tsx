import { act, fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { HostDocumentContext } from "@/ui/workbench/HostDocument";
import { WorkbenchDialog } from "@/ui/workbench/WorkbenchDialog";

it("handles Escape in the pop-out document without listening on the main window", async () => {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const win = frame.contentWindow!;
  const trigger = doc.createElement("button");
  doc.body.appendChild(trigger);
  trigger.focus();
  const close = vi.fn();
  const mounted = render(<HostDocumentContext.Provider value={doc}>
    <WorkbenchDialog title="Popout dialog" onClose={close}><input aria-label="Inside" /></WorkbenchDialog>
  </HostDocumentContext.Provider>, {container: doc.body.appendChild(doc.createElement("div")), baseElement: doc.body});
  fireEvent.keyDown(window, {key: "Escape"});
  expect(close).not.toHaveBeenCalled();
  const input = mounted.getByRole("textbox");
  input.focus();
  fireEvent.keyDown(input, {key: "Escape"});
  expect(close).toHaveBeenCalledTimes(1);
  await act(() => mounted.unmount());
  expect(doc.activeElement).toBe(trigger);
  fireEvent.keyDown(win, {key: "Escape"});
  expect(close).toHaveBeenCalledTimes(1);
  frame.remove();
});
