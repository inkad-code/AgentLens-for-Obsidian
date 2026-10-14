import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";

vi.hoisted(() => { process.env.AGENTLENS_RELEASE_PROFILE = "single-fetch-review"; });
import { WorkbenchApp } from "@/ui/WorkbenchApp";
import AgentLensPlugin from "@/main";
import { AgentLensWorkbenchService, DEMO_URL } from "@/workbench/AgentLensWorkbenchService";
import { AuthService } from "@/auth/AuthService";
import { PluginStateStore } from "@/runtime/PluginStateStore";
import { VaultWriter } from "@/vault/VaultWriter";
import type { AgentLensApiPort } from "@/workbench/ports";

import { normalizeAgentLensSettings } from "@/settings";
import { I18nProvider, useI18n } from "@/i18n/I18nProvider";
import { AgentLensApiClient } from "@/api/AgentLensApiClient";
import type { JsonTransport } from "@/runtime/ObsidianRequestUrlTransport";

function harness(PluginClass = AgentLensPlugin) {
  const onLayoutReady = vi.fn();
  const plugin = new PluginClass({
    secretStorage: { getSecret: () => "", setSecret: vi.fn() },
    workspace: { onLayoutReady }, vault: {}, fileManager: {}
  } as unknown as obsidian.App, { id: "agentlens-social-archiver", version: "0.1.0" } as obsidian.PluginManifest);
  return { plugin, onLayoutReady };
}

describe("Single Fetch review profile", () => {
  afterEach(() => vi.useRealTimers());

  it("forces English even when the saved locale or provider requests Chinese", () => {
    expect(normalizeAgentLensSettings({ locale: "zh-CN" }).locale).toBe("en");
    function Probe() { return <span>{useI18n().locale}</span>; }
    render(<I18nProvider locale="zh-TW"><Probe /></I18nProvider>);
    expect(screen.getByText("en")).toBeVisible();
  });

  it("excludes server transcripts and does not use them as post text", async () => {
    const transport: JsonTransport = { async json(_request, validate) {
      return validate({ success: true, data: {
        fetchId: "fetch-1", mode: "single_post", platform: "youtube",
        creator: { creatorId: "creator-1", displayName: "Creator" },
        content: [{ contentId: "post-1", source: { sourceUrl: "https://youtube.com/watch?v=demo" },
          text: { transcript: "Excluded transcript" }, media: [] }],
        page: null, usage: { charged: true, units: 1, remaining: 10 }
      } });
    } };
    const page = await new AgentLensApiClient(transport, {
      installationId: "install-1", deviceId: "device-1", clientVersion: "0.1.0",
      obsidianVersion: "1.13.7", platform: "desktop_macos"
    }).fetch("access", { url: "https://youtube.com/watch?v=demo", mode: "single_post" }, "idem", "request");
    expect(page.content[0]?.transcript).toBeUndefined();
    expect(page.content[0]?.text).toBe("");
  });

  it.each(["single", "bulk", "auto"] as const)("preserves manual workflows for %s and hides only top navigation and Auto/Activity", initialTab => {
    const { container } = render(<WorkbenchApp initialTab={initialTab} />);
    expect(screen.getByRole("tab", { name: initialTab === "bulk" ? "Bulk Fetch" : "Single Fetch" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("navigation", { name: "Main navigation", hidden: true })).toBeNull();
    expect(screen.getByRole("tablist", { name: "AgentLens workflows" })).toBeVisible();
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/Auto.fetch|Activity/);
    fireEvent.click(screen.getByRole("tab", { name: "Bulk Fetch" }));
    expect(screen.getByRole("tabpanel", { name: "Bulk Fetch" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Single Fetch" }));
    expect(screen.getByRole("tabpanel", { name: "Single Fetch" })).toBeVisible();
  });

  it("does not register scheduler lifecycle callbacks, timers or automatic commands", async () => {
    vi.useFakeTimers();
    const { plugin, onLayoutReady } = harness();
    await plugin.onload();
    const host = plugin as unknown as { __commands: Array<{ id: string }>; __intervals: number[] };
    expect(host.__commands.map(command => command.id)).toEqual(["open-panel", "fetch-current-link", "fetch-from-clipboard", "bulk-fetch-creator"]);
    expect(onLayoutReady).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(host.__intervals).toHaveLength(0);
    plugin.onunload();
  });

  it("blocks scheduler and activity service entrypoints and leaves recovery data untouched", async () => {
    const accessToken = vi.fn();
    const loadData = vi.fn(async () => ({}));
    const saveData = vi.fn();
    const service = new AgentLensWorkbenchService(
      { accessToken } as unknown as AuthService, { demoFetch: vi.fn(async () => ({
        fetchId: "demo", mode: "single_post", platform: "x", page: null,
        content: [{ platform: "x", contentId: "demo", canonicalUrl: DEMO_URL, text: "Server demo",
          author: { id: "spacex", displayName: "SpaceX" }, media: [] }],
        usage: { charged: false, units: 0, remaining: null }
      })) } as unknown as AgentLensApiPort,
      {} as VaultWriter, new PluginStateStore({ loadData, saveData })
    );
    for (const reason of ["service_start", "periodic_tick", "network_restored", "host_activated", "manual_sync"] as const) {
      expect(() => service.runScheduled(reason)).toThrow("unavailable in this review package");
    }
    await expect(service.autoFetchSetup()).rejects.toThrow("unavailable in this review package");
    await expect(service.activity({})).rejects.toThrow("unavailable in this review package");
    expect(await service.flushPendingWrites()).toBe(0);
    expect(await service.flushPendingCallbacks()).toBe(0);
    expect(accessToken).not.toHaveBeenCalled();
    expect(loadData).not.toHaveBeenCalled();
    expect(saveData).not.toHaveBeenCalled();
    expect((await service.previewSingle(DEMO_URL)).demo).toBe(true);
  });


  it("allows Bulk Fetch to reach its normal authentication boundary", async () => {
    const accessToken = vi.fn(async () => null);
    const service = new AgentLensWorkbenchService(
      { accessToken } as unknown as AuthService, {} as AgentLensApiPort,
      {} as VaultWriter, new PluginStateStore({ loadData: async () => ({}), saveData: async () => {} })
    );
    await expect(service.fetchProfilePage("https://youtube.com/@creator", null)).rejects.toThrow("Sign in before fetching a creator profile.");
    expect(accessToken).toHaveBeenCalledOnce();
  });

  it.skipIf(process.env.AGENTLENS_VERIFY_REVIEW_BUNDLE !== "1")("loads the actual production bundle with manual Single/Bulk commands and no scheduling", async () => {
    const bundle = readFileSync("main.js", "utf8");
    expect(bundle).toContain("AgentLens release profile: single-fetch-review");
    const module = { exports: {} as { default: typeof AgentLensPlugin } };
    const evaluate = runInThisContext(`(function(require,module,exports){${bundle}\n})`);
    evaluate((name: string) => { if (name === "obsidian") return obsidian; throw new Error(`Unexpected dependency: ${name}`); }, module, module.exports);
    const { plugin, onLayoutReady } = harness(module.exports.default);
    await plugin.onload();
    expect((plugin as unknown as { __commands: Array<{ id: string }>; __intervals: number[] }).__commands.map(command => command.id)).toEqual(["open-panel", "fetch-current-link", "fetch-from-clipboard", "bulk-fetch-creator"]);
    expect(onLayoutReady).not.toHaveBeenCalled();
    plugin.onunload();
  });
});

it("returns a legacy pending device session to login without exposing a code", async () => {
  const signOut = vi.fn(async () => undefined);
  const pending = { status: "authorizing" as const, authorization: {
    deviceCode: "legacy-secret", userCode: "LEGACY", verificationUri: "https://example.com", expiresIn: 600, interval: 5
  }, expiresAt: Date.now() + 600000, nextPollAt: Date.now() + 60000 };
  const service = { authState: () => pending, subscribeAuth: () => () => undefined,
    restoreAuth: async () => pending, signOut } as unknown as import("@/workbench/ports").AgentLensWorkbenchPort;
  render(<WorkbenchApp service={service} />);
  await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  expect(await screen.findByLabelText(/^Password/)).toBeVisible();
  expect(screen.queryByRole("region", { name: "Device authorization" })).toBeNull();
  expect(screen.queryByText("LEGACY")).toBeNull();
});
