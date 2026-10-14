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
