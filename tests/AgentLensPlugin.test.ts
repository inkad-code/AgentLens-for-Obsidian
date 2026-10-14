import { afterEach, describe, expect, it, vi } from "vitest";
import AgentLensPlugin from "@/main";
import { DEFAULT_SETTINGS } from "@/settings";
import { Platform, type App, type PluginManifest } from "obsidian";
import { DESKTOP_MEDIA_DOWNLOAD_LIMIT, MOBILE_MEDIA_DOWNLOAD_LIMIT, mediaDownloadLimit } from "@/core/platformPolicy";

interface PluginHarness {
  __commands: Array<{ id: string; callback: () => void }>;
  __ribbons: Array<{ icon: string; title: string; callback: () => void }>;
  __settingTabs: Array<{ display(): void }>;
  __intervals: number[];
  __setData(data: unknown): void;
  __getData(): unknown;
}

function host() {
  let layoutReady: (() => void) | undefined;
  const secrets = new Map<string, string>();
  const app = {
    secretStorage: {
      getSecret: (key: string) => secrets.get(key) ?? "",
      setSecret: (key: string, value: string) => { secrets.set(key, value); }
    },
    workspace: {
      onLayoutReady: (callback: () => void) => { layoutReady = callback; },
      getActiveViewOfType: () => null,
      getLeaf: () => ({ openFile: vi.fn() })
    },
    vault: {
      getAbstractFileByPath: () => null,
      read: vi.fn(),
      create: vi.fn(),
      modify: vi.fn(),
      createFolder: vi.fn(),
      createBinary: vi.fn()
    },
    fileManager: { processFrontMatter: vi.fn() }
  };
  return { app, layoutReady: () => layoutReady };
}

function pluginFor(app: unknown): AgentLensPlugin & PluginHarness {
  return new AgentLensPlugin(
    app as App,
    { id: "agentlens-social-importer", version: "0.1.0" } as PluginManifest
  ) as AgentLensPlugin & PluginHarness;
}

describe("AgentLensPlugin host adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.assign(Platform, {
      isMobile: false,
      isIosApp: false,
      isAndroidApp: false,
      isWin: false,
      isLinux: false
    });
  });

  it("registers one host-independent coordinator, commands, ribbon and native Settings tab", async () => {
    vi.useFakeTimers();
    const fixture = host();
    const plugin = pluginFor(fixture.app);

    await plugin.onload();

    expect(plugin.__ribbons).toEqual([expect.objectContaining({ icon: "agentlens-brand", title: "Open AgentLens" })]);
    expect(plugin.__commands.map((command) => command.id)).toEqual([
      "open-panel",
      "fetch-current-link",
      "fetch-from-clipboard",
      "bulk-fetch-creator",
      "add-creator-auto-fetch",
      "sync-due-creators"
    ]);
    expect(plugin.__settingTabs).toHaveLength(1);
    expect(() => plugin.__settingTabs[0]?.display()).not.toThrow();
    expect(plugin.__intervals).toHaveLength(0);

    fixture.layoutReady()?.();
    fixture.layoutReady()?.();
    expect(plugin.__intervals).toHaveLength(1);

    plugin.onunload();
    vi.advanceTimersByTime(180_000);
  });

  it("opens a native pop-out once, reuses it, and recreates it after closing", async () => {
    const fixture = host();
    const leaf = {setViewState: vi.fn(async () => {}), loadIfDeferred: vi.fn(async () => {}),
      getRoot: () => ({}), view: {}, detach: vi.fn()};
    let existing = false;
    const openPopoutLeaf = vi.fn(() => {existing = true; return leaf;});
    const revealLeaf = vi.fn(async () => {});
    Object.assign(fixture.app.workspace, {openPopoutLeaf, revealLeaf,
      getLeavesOfType: () => existing ? [leaf] : []});
    const plugin = pluginFor(fixture.app);
    await plugin.onload();
    const open = plugin.__ribbons[0]!.callback;
    open(); open();
    await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledTimes(1));
    expect(openPopoutLeaf).toHaveBeenCalledTimes(1);
    expect(leaf.setViewState).toHaveBeenCalledWith({type: "agentlens-workbench", active: true});
    open();
    await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledTimes(2));
    expect(openPopoutLeaf).toHaveBeenCalledTimes(1);
    existing = false;
    open();
    await vi.waitFor(() => expect(openPopoutLeaf).toHaveBeenCalledTimes(2));
    plugin.onunload();
  });

  it("repairs invalid settings, preserves unrelated data and persists only normalized non-secret settings", async () => {
    const fixture = host();
    const plugin = pluginFor(fixture.app);
    plugin.__setData({
      unrelated: { keep: true },
      agentlensSettings: {
        defaultFolderPath: "../Secrets",
        defaultTemplateId: "unknown",
        defaultMediaPolicy: "raw",
        addPlatformTag: false,
        addCreatorTag: true,
        addMediaTags: true,
        defaultAutoEvery: -4,
        defaultAutoUnit: "week",
        defaultAutoPreferredTime: "25:99"
      }
    });

    await plugin.onload();
    expect(plugin.agentlensSettings).toEqual({
      ...DEFAULT_SETTINGS,
      addPlatformTag: false,
      addCreatorTag: true,
      addMediaTags: true
    });

    plugin.agentlensSettings = {
      ...plugin.agentlensSettings,
      defaultFolderPath: " Research//AgentLens/ ",
      defaultTemplateId: "compact",
      defaultAutoEvery: 2,
      defaultAutoUnit: "day",
      defaultAutoPreferredTime: "08:30"
    };
    await plugin.saveSettings();

    expect(plugin.__getData()).toMatchObject({
      unrelated: { keep: true },
      agentlensSettings: {
        defaultFolderPath: "Research/AgentLens",
        defaultTemplateId: "default",
        defaultMediaPolicy: "download_all",
        defaultAutoEvery: 2,
        defaultAutoUnit: "day",
        defaultAutoPreferredTime: "08:30"
      },
      agentlensState: {
        ledger: {},
        pendingActions: []
      }
    });
    expect(JSON.stringify(plugin.__getData())).not.toMatch(/accessToken|refreshToken|Bearer/i);
    plugin.onunload();
  });

  it("copies a bounded diagnostic summary without paths, note bodies or secret material", async () => {
    const fixture = host();
    const plugin = pluginFor(fixture.app);
    plugin.__setData({
      agentlensState: {
        schemaVersion: 1,
        installationId: "12345678-secret-installation-tail",
        refreshTokenSecretId: "agentlens-refresh-private-reference",
        ledger: {
          "youtube:one": {
            notePath: "Private/Vault/Research.md",
            sourceUrl: "https://example.com/private-source"
          }
        },
        pendingActions: [{ id: "pending-secret", kind: "result_callback", createdAt: "2026-08-20T00:00:00Z", payload: {} }]
      }
    });
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await plugin.onload();
    expect(plugin.diagnosticsSummarySnapshot()).toMatchObject({
      shortInstallationId: "12345678",
      pendingActions: 1,
      ledgerEntries: 1
    });
    await plugin.copyDiagnostics();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('"shortInstallationId": "12345678"');
    expect(copied).toContain('"pendingActions": 1');
    expect(copied).toContain('"ledgerEntries": 1');
    expect(copied).not.toMatch(/Private\/Vault|private-source|refresh-private|pending-secret/);
    plugin.onunload();
  });


  it("uses canonical mobile identities and the 10 MB media limit on iOS and Android", async () => {
    for (const mobile of [
      { flag: "isIosApp" as const, expected: "mobile_ios" },
      { flag: "isAndroidApp" as const, expected: "mobile_android" }
    ]) {
      Object.assign(Platform, { isMobile: true, isIosApp: false, isAndroidApp: false, [mobile.flag]: true });
      const fixture = host();
      const plugin = pluginFor(fixture.app);
      await plugin.onload();

      expect((await plugin.diagnosticsSummary()).environment).toContain(mobile.expected);
      expect(mediaDownloadLimit(Platform.isMobile)).toBe(MOBILE_MEDIA_DOWNLOAD_LIMIT);
      plugin.onunload();
    }

    Object.assign(Platform, { isMobile: false, isIosApp: false, isAndroidApp: false });
    expect(mediaDownloadLimit(Platform.isMobile)).toBe(DESKTOP_MEDIA_DOWNLOAD_LIMIT);
  });
});
