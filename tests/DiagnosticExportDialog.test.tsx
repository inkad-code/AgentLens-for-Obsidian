import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiagnosticExportDialog } from "@/ui/workbench/DiagnosticExportDialog";
import type { AgentLensWorkbenchPort } from "@/workbench/ports";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  let resolve!: (value: object) => void;
  const exportLocalDiagnostics = vi.fn(() => new Promise<object>(done => { resolve = done; }));
  const onClose = vi.fn();
  const create = vi.fn((_blob: Blob) => "blob:local-diagnostics");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const view = render(<DiagnosticExportDialog service={{ exportLocalDiagnostics } as unknown as AgentLensWorkbenchPort} onClose={onClose} />);
  return { ...view, exportLocalDiagnostics, onClose, create, click, resolve: () => resolve({ schema: "fixture" }) };
}
it("does not generate data when confirmation is cancelled", () => {
  const f = fixture(); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(f.exportLocalDiagnostics).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled(); expect(f.onClose).toHaveBeenCalledOnce();
});
it("exports one local JSON after confirmation and suppresses repeated submissions", async () => {
  const f = fixture(); const button = screen.getByRole("button", { name: "Export JSON" });
  fireEvent.click(button); fireEvent.click(button);
  expect(f.exportLocalDiagnostics).toHaveBeenCalledOnce();
  await act(async () => f.resolve());
  expect(f.create).toHaveBeenCalledOnce(); expect(f.click).toHaveBeenCalledOnce(); expect(f.onClose).toHaveBeenCalledOnce();
  expect(f.create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
});
it.each(["cancel", "unmount"])("discards a late export after %s", async reason => {
  const f = fixture(); fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
  if (reason === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" })); else f.unmount();
  await act(async () => f.resolve()); expect(f.create).not.toHaveBeenCalled(); expect(f.click).not.toHaveBeenCalled();
});
it("shows a safe retry message without exposing the underlying error", async () => {
  const service = { exportLocalDiagnostics: vi.fn().mockRejectedValue(new Error("secret /local/path")) } as unknown as AgentLensWorkbenchPort;
  render(<DiagnosticExportDialog service={service} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not export diagnostics");
  expect(screen.queryByText(/secret/)).toBeNull(); expect(screen.getByRole("button", { name: "Export JSON" })).not.toBeDisabled();
});
