import { describe, expect, it, vi } from "vitest";
import { Setting } from "obsidian";
import { AgentLensSettingTab, DEFAULT_SETTINGS } from "@/settings";

function fixture() {
  const host = {
    app: {}, manifest: { version: "0.1.1" },
    agentlensSettings: { ...DEFAULT_SETTINGS }, saveSettings: vi.fn().mockResolvedValue(undefined),
    diagnosticsSummarySnapshot: vi.fn(), diagnosticsSummary: vi.fn(),
    openWorkbench: vi.fn(), copyDiagnostics: vi.fn()
  };
  const tab = new AgentLensSettingTab(host as unknown as ConstructorParameters<typeof AgentLensSettingTab>[0]);
  return { host, tab };
}

describe("searchable settings", () => {
  it("indexes rows without loading diagnostics or persisting data", () => {
    const {host,tab} = fixture();
    expect(tab.getSettingDefinitions().map(row => row.name)).toContain("Default note folder");
    expect(host.diagnosticsSummary).not.toHaveBeenCalled();
    expect(host.diagnosticsSummarySnapshot).not.toHaveBeenCalled();
    expect(host.saveSettings).not.toHaveBeenCalled();
  });

  it("uses the existing validated settings store when a searchable control changes", async () => {
    const {host,tab} = fixture();
    let change: (value: string) => Promise<void> = async () => {};
    const component = {setPlaceholder: () => component, setValue: () => component, onChange: (fn: typeof change) => {change=fn;return component;}};
    const setting = {setName: () => setting, setDesc: () => setting, addText: (fn: (c: typeof component) => void) => {fn(component); return setting;}};
    tab.getSettingDefinitions().find(row => row.name === "Default note folder")!.render(setting as unknown as Setting);
    await change("../../outside");
    expect(host.agentlensSettings.defaultFolderPath).toBe("AgentLens/Inbox");
    await change("AgentLens/Verified");
    expect(host.agentlensSettings.defaultFolderPath).toBe("AgentLens/Verified");
    expect(host.saveSettings).toHaveBeenCalledTimes(2);
  });
});


describe("asynchronous settings diagnostics", () => {
  it.each([false, true])("does not assimilate the host Setting thenable (failed=%s)", async failed => {
    const {host, tab} = fixture();
    const summary = {environment: "desktop", shortInstallationId: "test", pendingActions: 0, ledgerEntries: 0};
    host.diagnosticsSummarySnapshot.mockReturnValue(summary);
    host.diagnosticsSummary.mockImplementation(() => failed ? Promise.reject(new Error("offline")) : Promise.resolve(summary));
    // The real Setting.then invokes its callback with itself. Count assimilation
    // without resolving again, so a regression fails instead of hanging Vitest.
    const then = vi.fn();
    const setting = {then, setName: () => setting, setDesc: vi.fn((_description: string) => setting), addButton: () => setting};
    tab.getSettingDefinitions().find(row => row.name === "Account and diagnostics")!.render(setting as unknown as Setting);
    await Promise.resolve(); await Promise.resolve();
    expect(setting.setDesc).toHaveBeenCalledTimes(2);
    expect(setting.setDesc.mock.calls[1]?.[0]).toContain(failed ? "temporarily unavailable" : "installation test");
    expect(then).not.toHaveBeenCalled();
  });
});
