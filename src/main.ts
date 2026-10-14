import { SINGLE_FETCH_REVIEW } from "./core/releaseProfile";
import { addIcon, apiVersion, MarkdownView, Notice, Platform, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, AgentLensSettingTab, normalizeAgentLensSettings, type AgentLensSettings } from "./settings";
import { HostLifecycleCoordinator } from "./runtime/HostLifecycleCoordinator";
import { WorkbenchView, WORKBENCH_VIEW_TYPE } from "./ui/WorkbenchView";
import type { WorkbenchTab } from "./ui/WorkbenchApp";
import { WORKBENCH_POPOUT_SIZE } from "./ui/workbench/popoutChrome";
import { PluginStateStore, type AgentLensPluginState } from "./runtime/PluginStateStore";
import { SecretTokenStore } from "./runtime/SecretTokenStore";
import { ObsidianRequestUrlTransport } from "./runtime/ObsidianRequestUrlTransport";
import { ObsidianRefreshTokenPersistence } from "./auth/ObsidianRefreshTokenPersistence";
import { HumanVerification } from "./auth/HumanVerification";
import { AuthService } from "./auth/AuthService";
import { AgentLensApiClient } from "./api/AgentLensApiClient";
import { ObsidianVaultPort } from "./vault/ObsidianVaultPort";
import { VaultWriter } from "./vault/VaultWriter";
import { AgentLensWorkbenchService } from "./workbench/AgentLensWorkbenchService";
import { ObsidianMediaDownloader } from "./vault/ObsidianMediaDownloader";
import apiTargets from "../api-targets.json";
import { ConnectivityGate } from "./runtime/ConnectivityGate";
import { mediaDownloadLimit } from "./core/platformPolicy";
import { designAssets } from "./ui/workbench/designAssets";
import ribbonLogo from "./ui/workbench/assets/agentlens-ribbon-logo.svg";

const AGENTLENS_RIBBON_ICON = "agentlens-brand";
const AGENTLENS_RIBBON_ICON_CONTENT = `
  <path fill-rule="evenodd" clip-rule="evenodd" d="M12.0392 4.90526L19.24 19.1234L19.8784 18.7998L12.0392 3.32L4.2 18.7998L4.83843 19.1234L12.0392 4.90526ZM14.684 19.32H14.685C15.2391 19.3196 15.7369 19.034 16.0181 18.5571C16.2995 18.0798 16.3077 17.5053 16.0396 17.0199L13.4542 12.3369C13.1769 11.8351 12.6705 11.5361 12.0985 11.5361C11.5266 11.5361 11.0191 11.8361 10.7429 12.3369L8.15745 17.0199C7.88939 17.5043 7.89757 18.0798 8.17893 18.5571C8.46029 19.0353 8.95958 19.32 9.51309 19.32H14.684ZM11.3711 12.684C11.5194 12.4147 11.7916 12.2539 12.0996 12.2539H12.1006C12.4075 12.2539 12.6807 12.4147 12.829 12.684L15.4145 17.3671C15.5587 17.6282 15.5547 17.9375 15.4032 18.1935C15.2518 18.4495 14.9837 18.6031 14.686 18.6031H9.51411C9.21638 18.6031 8.94832 18.4505 8.7969 18.1935C8.64548 17.9365 8.64138 17.6282 8.78564 17.3671L11.3711 12.684Z" fill="#2463EB"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M19.3304 19.3818L19.9688 19.0582C19.9747 19.0552 19.9803 19.052 19.9859 19.0484C19.9914 19.0449 19.9967 19.0411 20.0019 19.0371C20.007 19.0331 20.012 19.0288 20.0167 19.0242C20.0214 19.0197 20.0259 19.015 20.0302 19.01C20.0345 19.005 20.0385 18.9999 20.0422 18.9945C20.046 18.9891 20.0495 18.9836 20.0527 18.9779C20.0559 18.9722 20.0588 18.9663 20.0615 18.9603C20.0641 18.9543 20.0664 18.9482 20.0685 18.942C20.0705 18.9358 20.0722 18.9295 20.0737 18.9231C20.0751 18.9167 20.0762 18.9102 20.077 18.9037C20.0777 18.8972 20.0782 18.8907 20.0783 18.8842C20.0785 18.8776 20.0783 18.8711 20.0778 18.8646C20.0773 18.858 20.0765 18.8515 20.0754 18.8451C20.0742 18.8386 20.0728 18.8323 20.071 18.826C20.0693 18.8196 20.0672 18.8134 20.0648 18.8073C20.0624 18.8012 20.0598 18.7954 20.0568 18.7894L12.2176 3.30964C12.208 3.29065 12.1957 3.27363 12.1806 3.25858C12.1656 3.24353 12.1485 3.23119 12.1296 3.22158C12.1178 3.21564 12.1057 3.21091 12.093 3.20738C12.0804 3.20384 12.0675 3.20158 12.0544 3.20058C12.0413 3.19958 12.0282 3.19987 12.0152 3.20145C12.0022 3.20302 11.9894 3.20585 11.9769 3.20994C11.9644 3.21403 11.9525 3.2193 11.941 3.22574C11.9296 3.23219 11.9189 3.23969 11.9089 3.24824C11.899 3.25679 11.8899 3.26624 11.8818 3.27657C11.8737 3.2869 11.8667 3.29793 11.8608 3.30964L4.02158 18.7894C4.01862 18.7953 4.01596 18.8012 4.01358 18.8073C4.01121 18.8134 4.00914 18.8196 4.00738 18.826C4.00562 18.8323 4.00417 18.8386 4.00304 18.8451C4.0019 18.8515 4.00108 18.858 4.00058 18.8646C4.00009 18.8711 3.99991 18.8776 4.00005 18.8842C4.0002 18.8907 4.00066 18.8972 4.00145 18.9037C4.00223 18.9102 4.00333 18.9167 4.00475 18.9231C4.00617 18.9295 4.0079 18.9358 4.00994 18.942C4.01197 18.9482 4.01431 18.9543 4.01695 18.9603C4.01959 18.9663 4.02251 18.9722 4.02572 18.9779C4.02894 18.9836 4.03242 18.9891 4.03618 18.9945C4.03993 18.9999 4.04394 19.005 4.04821 19.01C4.05247 19.015 4.05697 19.0197 4.0617 19.0242C4.06643 19.0288 4.07137 19.0331 4.07652 19.0371C4.08168 19.0411 4.08701 19.0449 4.09254 19.0484C4.09806 19.052 4.10374 19.0552 4.10958 19.0582L4.74801 19.3818C4.75973 19.3877 4.77197 19.3925 4.78462 19.396C4.79727 19.3995 4.81014 19.4018 4.82323 19.4028C4.83633 19.4038 4.84939 19.4035 4.86243 19.4019C4.87547 19.4004 4.88822 19.3975 4.9007 19.3934C4.91318 19.3894 4.92514 19.3841 4.93659 19.3776C4.94803 19.3712 4.95873 19.3637 4.9687 19.3551C4.97866 19.3466 4.9877 19.3371 4.9958 19.3268C5.00391 19.3165 5.01093 19.3055 5.01686 19.2937L12.0392 5.42792L19.0615 19.2937C19.0645 19.2996 19.0678 19.3053 19.0713 19.3109C19.0748 19.3164 19.0786 19.3217 19.0826 19.3269C19.0867 19.332 19.091 19.337 19.0955 19.3417C19.1 19.3464 19.1048 19.3509 19.1098 19.3552C19.1147 19.3595 19.1199 19.3635 19.1253 19.3672C19.1306 19.371 19.1362 19.3745 19.1419 19.3777C19.1476 19.3809 19.1534 19.3838 19.1594 19.3864C19.1654 19.3891 19.1715 19.3914 19.1778 19.3935C19.184 19.3955 19.1903 19.3972 19.1967 19.3986C19.2031 19.4001 19.2095 19.4012 19.216 19.4019C19.2225 19.4027 19.2291 19.4032 19.2356 19.4033C19.2422 19.4035 19.2487 19.4033 19.2552 19.4028C19.2618 19.4023 19.2683 19.4015 19.2747 19.4003C19.2812 19.3992 19.2875 19.3977 19.2938 19.396C19.3002 19.3942 19.3064 19.3921 19.3125 19.3898C19.3186 19.3874 19.3245 19.3847 19.3304 19.3818ZM19.6096 18.7918L12.0392 3.84269L4.46875 18.7918L4.75041 18.9345L11.8608 4.89489C11.8704 4.8759 11.8827 4.85888 11.8978 4.84383C11.9128 4.82878 11.9299 4.81645 11.9488 4.80683C11.9606 4.8009 11.9727 4.79616 11.9854 4.79263C11.998 4.7891 12.0109 4.78683 12.024 4.78583C12.0371 4.78483 12.0502 4.78512 12.0632 4.7867C12.0762 4.78827 12.089 4.79111 12.1015 4.79519C12.1139 4.79928 12.1259 4.80455 12.1374 4.81099C12.1488 4.81744 12.1595 4.82494 12.1695 4.83349C12.1794 4.84204 12.1885 4.85149 12.1966 4.86182C12.2047 4.87215 12.2117 4.88318 12.2176 4.89489L19.328 18.9345L19.6096 18.7918ZM14.6854 19.6C15.3504 19.5996 15.8521 19.3124 16.1904 18.7386C16.5287 18.1649 16.5368 17.5865 16.2147 17.0033L13.6292 12.3201C13.2962 11.7174 12.786 11.4161 12.0985 11.4161C11.4106 11.4161 10.9003 11.7174 10.5678 12.3202L7.98245 17.0031C7.65998 17.5858 7.66801 18.1643 8.00655 18.7385C8.34445 19.3128 8.84663 19.6 9.51309 19.6H14.6854ZM15.8458 18.5355C15.5848 18.9782 15.1979 19.1997 14.685 19.2H9.51309C8.99914 19.2 8.61188 18.9785 8.35131 18.5356C8.09002 18.0925 8.08373 17.6462 8.33244 17.1968L10.918 12.5135C11.1745 12.0485 11.568 11.8161 12.0985 11.8161C12.6286 11.8161 13.0222 12.0486 13.2791 12.5136L15.8645 17.1966C16.113 17.6466 16.1068 18.0929 15.8458 18.5355ZM13.0041 12.6674C12.8082 12.3117 12.5071 12.1339 12.1006 12.1339H12.1003H12.0993C11.693 12.1339 11.3919 12.3118 11.1959 12.6675L8.61056 17.3504C8.42034 17.6947 8.42502 18.0363 8.62458 18.375C8.82413 18.7138 9.12064 18.8831 9.51411 18.8831H14.686C15.0787 18.8831 15.3751 18.7139 15.5754 18.3753C15.7754 18.0371 15.7802 17.6954 15.5895 17.3504L13.0041 12.6674ZM12.1006 12.5339H12.1008C12.3496 12.534 12.534 12.6429 12.654 12.8607L15.2394 17.5438C15.3563 17.7554 15.3535 17.9647 15.2311 18.1717C15.1083 18.3793 14.9266 18.4831 14.686 18.4831H9.51411C9.27305 18.4831 9.09142 18.3794 8.96922 18.172C8.8469 17.9643 8.84407 17.7549 8.96073 17.5437L11.5463 12.8605C11.6662 12.6428 11.8507 12.5339 12.0998 12.5339H12.1006Z" fill="#2463EB"/>
`;

function dataUrlToIconContent(dataUrl: string): string {
  const svgPrefix = "data:image/svg+xml;base64,";
  if (dataUrl.startsWith(svgPrefix)) {
    const svg = atob(dataUrl.slice(svgPrefix.length));
    const match = svg.match(/^\s*<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i);
    if (!match) throw new Error("Expected SVG markup.");
    return match[1]!;
  }

  const encodedSvgPrefix = "data:image/svg+xml,";
  if (dataUrl.startsWith(encodedSvgPrefix)) {
    const svg = decodeURIComponent(dataUrl.slice(encodedSvgPrefix.length));
    const match = svg.match(/^\s*<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i);
    if (!match) throw new Error("Expected SVG markup.");
    return match[1]!;
  }

  if (dataUrl.startsWith("data:image/png;base64,")) {
    return `<image href="${dataUrl}" width="24" height="24" preserveAspectRatio="xMidYMid meet" />`;
  }

  throw new Error("Unsupported ribbon icon format.");
}

export default class AgentLensPlugin extends Plugin {
  settings: AgentLensSettings = DEFAULT_SETTINGS;
  private openingWorkbench: Promise<void> | undefined;
  private workbenchService!: AgentLensWorkbenchService;
  private latestState?: Readonly<AgentLensPluginState>;
  private unsubscribeState?: (() => void) | undefined;
  private readonly connectivity = new ConnectivityGate();
  private readonly stateStore = new PluginStateStore({
    loadData: () => this.loadData(),
    saveData: (data) => this.saveData(data)
  });
  private coordinator = new HostLifecycleCoordinator({
    onTick: async (reason) => {
      if (SINGLE_FETCH_REVIEW || !this.workbenchService) return;
      if (!this.connectivity.isOnline()) return;
      try {
        await this.workbenchService.runScheduled(reason);
      } catch {
        // Scheduler failures remain server-authoritative and are surfaced by the
        // next reconcile in Auto-Fetch. Never leak source URLs or tokens to logs.
      }
    }
  });

  async onload(): Promise<void> {
    let ribbonIconName = AGENTLENS_RIBBON_ICON;
    try {
      addIcon(ribbonIconName, dataUrlToIconContent(ribbonLogo));
    } catch {
      addIcon(ribbonIconName, AGENTLENS_RIBBON_ICON_CONTENT);
    }
    this.unsubscribeState = this.stateStore.subscribe((state) => { this.latestState = state; });
    const state = await this.stateStore.load();
    await this.loadSettings();
    const api = new AgentLensApiClient(
      new ObsidianRequestUrlTransport(
        process.env.AGENTLENS_API_BASE_URL ?? apiTargets.production,
        undefined,
        () => crypto.randomUUID(),
        this.manifest.version,
        apiVersion
      ),
      {
        installationId: state.installationId,
        deviceId: `obsidian-${state.installationId}`,
        clientVersion: this.manifest.version,
        obsidianVersion: apiVersion,
        platform: currentPlatform()
      }
    );
    const verification = new HumanVerification(
      url => window.open(url, "_blank", "noopener,noreferrer"),
      new URL(process.env.AGENTLENS_API_BASE_URL ?? apiTargets.production).origin
    );
    this.registerObsidianProtocolHandler("agentlens-human-verification", params => verification.receive(params));
    this.register(() => verification.dispose());
    const auth = new AuthService(
      api,
      new ObsidianRefreshTokenPersistence(
        this.stateStore,
        new SecretTokenStore(this.app.secretStorage)
      ),
      () => Date.now(),
      signal => verification.request(signal)
    );
    const createVaultWriter = (options: {
      folderPath?: string | undefined;
      mediaPolicy?: AgentLensSettings["defaultMediaPolicy"] | undefined;
      templateId?: AgentLensSettings["defaultTemplateId"] | undefined;
    } = {}) => this.createVaultWriter(options);
    this.workbenchService = new AgentLensWorkbenchService(
      auth,
      api,
      createVaultWriter(),
      this.stateStore,
      () => crypto.randomUUID(),
      new ObsidianMediaDownloader(mediaDownloadLimit(Platform.isMobile)),
      createVaultWriter
    );

    this.registerView(WORKBENCH_VIEW_TYPE, leaf => new WorkbenchView(leaf, this.workbenchService, this.workbenchDefaults()));

    const ribbonIcon = this.addRibbonIcon(ribbonIconName, "Open AgentLens", () => this.openWorkbench("single"));
    if (ribbonIconName === AGENTLENS_RIBBON_ICON) ribbonIcon.querySelector("svg")?.setAttribute("viewBox", "0 0 24 24");
    this.addCommand({
      id: "open-panel",
      name: "Open panel",
      callback: () => this.openWorkbench("single")
    });
    this.addCommand({
      id: "fetch-current-link",
      name: "Fetch current link",
      callback: () => {
        const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        const source = editor?.getSelection() || editor?.getLine(editor.getCursor().line) || "";
        const url = source.match(/https?:\/\/[^\s)\]>]+/)?.[0];
        if (url) this.openWorkbench("single", url);
        else new Notice("Select a public link or place the cursor on a line containing one.");
      }
    });
    this.addCommand({
      id: "fetch-from-clipboard",
      name: "Fetch from clipboard",
      callback: () => {
        if (!navigator.clipboard) {
          new Notice("Clipboard access is unavailable. Paste the link in AgentLens instead.");
          return;
        }
        void navigator.clipboard.readText().then(
          (value) => this.openWorkbench("single", value),
          () => new Notice("Clipboard access is unavailable. Paste the link in AgentLens instead.")
        );
      }
    });
    this.addCommand({
      id: "bulk-fetch-creator",
      name: "Bulk fetch creator",
      callback: () => this.openWorkbench("bulk")
    });
    if (!SINGLE_FETCH_REVIEW) {
    this.addCommand({
      id: "add-creator-auto-fetch",
      name: "Add creator to Auto-Fetch",
      callback: () => this.openWorkbench("auto")
    });
    this.addCommand({
      id: "sync-due-creators",
      name: "Sync due creators",
      callback: () => {
        this.openWorkbench("auto");
        void this.workbenchService.runScheduled("manual_sync").then(
          (result) => new Notice(
            result.skipped === "signed_out"
              ? "Sign in before syncing Auto-Fetch creators."
              : `Auto-Fetch checked ${result.leases} creator check(s); ${result.saved} note(s) saved.${result.deferred ? ` ${result.deferred} waiting for another check.` : ""}${result.terminated ? ` ${result.terminated} check(s) ended unsuccessfully.` : ""}`
          ),
          () => new Notice("Auto-Fetch sync failed. Open AgentLens to review the creator status.")
        );
      }
    });

    }

    this.addSettingTab(new AgentLensSettingTab(this));
    if (!SINGLE_FETCH_REVIEW) this.app.workspace.onLayoutReady(() => {
      this.coordinator.start((id) => this.registerInterval(id));
    });
  }

  onunload(): void {

    this.coordinator.stop();
    this.unsubscribeState?.();
    this.unsubscribeState = undefined;
  }

  openWorkbench(tab: WorkbenchTab, initialUrl?: string): void {
    if (this.openingWorkbench) return;
    this.openingWorkbench = this.openWorkbenchWindow(SINGLE_FETCH_REVIEW && tab === "auto" ? "single" : tab, initialUrl)
      .catch(() => { new Notice("Unable to open AgentLens window. Please try again."); })
      .finally(() => { this.openingWorkbench = undefined; });
  }

  private async openWorkbenchWindow(tab: WorkbenchTab, initialUrl?: string): Promise<void> {
    const workspace = this.app.workspace;
    let leaf = workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = Platform.isMobile ? workspace.getLeaf("tab") : workspace.openPopoutLeaf({size: {...WORKBENCH_POPOUT_SIZE}});
      try { await leaf.setViewState({type: WORKBENCH_VIEW_TYPE, active: true}); }
      catch (error) { leaf.detach(); throw error; }
    } else if (!Platform.isMobile && leaf.getRoot() === workspace.rootSplit) {
      workspace.moveLeafToPopout(leaf, {size: {...WORKBENCH_POPOUT_SIZE}});
    }
    await leaf.loadIfDeferred();
    if (leaf.view instanceof WorkbenchView) leaf.view.configure(tab, initialUrl);
    await workspace.revealLeaf(leaf);
    if (leaf.view instanceof WorkbenchView) leaf.view.refreshHost();
  }

  private workbenchDefaults() {
    return {
      locale: this.settings.locale,
      folderPath: this.settings.defaultFolderPath,
      templateId: this.settings.defaultTemplateId,
      mediaPolicy: this.settings.defaultMediaPolicy,
      autoEvery: this.settings.defaultAutoEvery,
      autoUnit: this.settings.defaultAutoUnit,
      autoPreferredTime: this.settings.defaultAutoPreferredTime
    };
  }

  async loadSettings(): Promise<void> {
    const data = await this.stateStore.readRoot();
    const stored = isRecord(data.agentlensSettings)
      ? data.agentlensSettings as Partial<AgentLensSettings>
      : {};
    this.settings = normalizeAgentLensSettings(stored);
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeAgentLensSettings(this.settings);
    await this.stateStore.patchRoot({ agentlensSettings: this.settings });
    if (this.workbenchService) {
      this.workbenchService.setVaultWriter(this.createVaultWriter());
    }
  }

  private createVaultWriter(options: {
    folderPath?: string | undefined;
    mediaPolicy?: AgentLensSettings["defaultMediaPolicy"] | undefined;
    templateId?: AgentLensSettings["defaultTemplateId"] | undefined;
  } = {}): VaultWriter {
    return new VaultWriter(new ObsidianVaultPort(this.app, this.stateStore), {
      folderPath: options.folderPath ?? this.settings.defaultFolderPath,
      mediaPolicy: options.mediaPolicy ?? this.settings.defaultMediaPolicy,
      templateId: options.templateId ?? this.settings.defaultTemplateId,
      addPlatformTag: this.settings.addPlatformTag,
      addCreatorTag: this.settings.addCreatorTag,
      addMediaTags: this.settings.addMediaTags,
      maxDownloadBytes: mediaDownloadLimit(Platform.isMobile)
    });
  }

  async diagnosticsSummary(): Promise<{ environment: string; shortInstallationId: string; pendingActions: number; ledgerEntries: number }> {
    const state = await this.stateStore.load();
    return this.diagnosticsSummaryFrom(state);
  }

  diagnosticsSummarySnapshot(): { environment: string; shortInstallationId: string; pendingActions: number; ledgerEntries: number } {
    const state = this.latestState;
    return state
      ? this.diagnosticsSummaryFrom(state)
      : { environment: `${currentPlatform()} · Obsidian API ${apiVersion}`, shortInstallationId: "pending", pendingActions: 0, ledgerEntries: 0 };
  }

  private diagnosticsSummaryFrom(state: Readonly<AgentLensPluginState>): { environment: string; shortInstallationId: string; pendingActions: number; ledgerEntries: number } {
    return {
      environment: `${currentPlatform()} · Obsidian API ${apiVersion}`,
      shortInstallationId: state.installationId.slice(0, 8),
      pendingActions: state.pendingActions.length,
      ledgerEntries: Object.keys(state.ledger).length
    };
  }

  async copyDiagnostics(): Promise<void> {
    const summary = await this.diagnosticsSummary();
    await navigator.clipboard.writeText(JSON.stringify({
      pluginVersion: this.manifest.version,
      ...summary
    }, null, 2));
    new Notice("Copied privacy-safe AgentLens diagnostics.");
  }

}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function currentPlatform(): "desktop_macos" | "desktop_windows" | "desktop_linux" | "mobile_ios" | "mobile_android" {
  if (Platform.isIosApp) return "mobile_ios";
  if (Platform.isAndroidApp) return "mobile_android";
  if (Platform.isWin) return "desktop_windows";
  if (Platform.isLinux) return "desktop_linux";
  return "desktop_macos";
}
