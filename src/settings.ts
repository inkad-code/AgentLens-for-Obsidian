import { SINGLE_FETCH_REVIEW } from "./core/releaseProfile";
import { Plugin, PluginSettingTab, Setting } from "obsidian";
import { normalizeVaultRelativePath } from "./core/vaultPaths";
import type { MediaPolicy } from "./core/domain";
import type { FrequencyUnit } from "./api/AgentLensApiClient";
import { resolveLocale, type Locale } from "./i18n/catalog";

export interface AgentLensSettings {
  locale: Locale;
  defaultFolderPath: string;
  defaultTemplateId: "default" | "compact";
  defaultMediaPolicy: MediaPolicy;
  addPlatformTag: boolean;
  addCreatorTag: boolean;
  addMediaTags: boolean;
  defaultAutoEvery: number;
  defaultAutoUnit: FrequencyUnit;
  defaultAutoPreferredTime: string;
}

export const DEFAULT_SETTINGS: AgentLensSettings = {
  locale: "en",
  defaultFolderPath: "AgentLens/Inbox",
  defaultTemplateId: "default",
  defaultMediaPolicy: "download_all",
  addPlatformTag: true,
  addCreatorTag: true,
  addMediaTags: false,
  defaultAutoEvery: 4,
  defaultAutoUnit: "hour",
  defaultAutoPreferredTime: "09:00"
};

type AgentLensSettingsHost = Plugin & {
  settings: AgentLensSettings;
  saveSettings(): Promise<void>;
  openWorkbench(tab: "single" | "bulk" | "auto"): void;
  copyDiagnostics(): Promise<void>;
  diagnosticsSummarySnapshot(): DiagnosticsSummary;
  diagnosticsSummary(): Promise<DiagnosticsSummary>;
};

interface DiagnosticsSummary {
  environment: string;
  shortInstallationId: string;
  pendingActions: number;
  ledgerEntries: number;
}

export function normalizeAgentLensSettings(stored: Partial<AgentLensSettings>): AgentLensSettings {
  const validEvery = typeof stored.defaultAutoEvery === "number"
    && Number.isFinite(stored.defaultAutoEvery)
    && stored.defaultAutoEvery > 0;
  const defaultAutoUnit: FrequencyUnit = validEvery && stored.defaultAutoUnit === "week"
    ? "week"
    : validEvery && stored.defaultAutoUnit === "day" ? "day" : "hour";
  return {
    locale: SINGLE_FETCH_REVIEW ? "en" : resolveLocale(stored.locale),
    defaultFolderPath: safeFolderPath(stored.defaultFolderPath),
    defaultTemplateId: "default",
    defaultMediaPolicy: stored.defaultMediaPolicy === "download_images_only" || stored.defaultMediaPolicy === "link_only"
      ? stored.defaultMediaPolicy
      : "download_all",
    addPlatformTag: typeof stored.addPlatformTag === "boolean" ? stored.addPlatformTag : DEFAULT_SETTINGS.addPlatformTag,
    addCreatorTag: typeof stored.addCreatorTag === "boolean" ? stored.addCreatorTag : DEFAULT_SETTINGS.addCreatorTag,
    addMediaTags: typeof stored.addMediaTags === "boolean" ? stored.addMediaTags : DEFAULT_SETTINGS.addMediaTags,
    defaultAutoEvery: validEvery
      ? defaultAutoUnit === "week" ? Math.min(12, Math.floor(stored.defaultAutoEvery!)) : Math.floor(stored.defaultAutoEvery!)
      : DEFAULT_SETTINGS.defaultAutoEvery,
    defaultAutoUnit,
    defaultAutoPreferredTime: typeof stored.defaultAutoPreferredTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(stored.defaultAutoPreferredTime)
      ? stored.defaultAutoPreferredTime
      : DEFAULT_SETTINGS.defaultAutoPreferredTime
  };
}

function safeFolderPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_SETTINGS.defaultFolderPath;
  try {
    return normalizeVaultRelativePath(value);
  } catch {
    return DEFAULT_SETTINGS.defaultFolderPath;
  }
}

export class AgentLensSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: AgentLensSettingsHost) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AgentLens" });

    new Setting(containerEl)
      .setName("Plugin version")
      .setDesc(`${this.plugin.manifest.version} · updates are installed through Obsidian Community Plugins`);

    if (!SINGLE_FETCH_REVIEW) new Setting(containerEl)
      .setName("Language")
      .setDesc("Language used in the AgentLens workbench.")
      .addDropdown((dropdown) => dropdown
        .addOption("en", "English")
        .addOption("zh-CN", "简体中文")
        .addOption("zh-TW", "繁體中文")
        .setValue(this.plugin.settings.locale)
        .onChange(async (value) => {
          this.plugin.settings.locale = resolveLocale(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Default note folder")
      .setDesc("Vault-relative folder used for new saves. Each save can override it.")
      .addText((text) => text
        .setPlaceholder("AgentLens/Inbox")
        .setValue(this.plugin.settings.defaultFolderPath)
        .onChange(async (value) => {
          this.plugin.settings.defaultFolderPath = safeFolderPath(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Default media policy")
      .setDesc("Large or unavailable media can still fall back to links and a partial note.")
      .addDropdown((dropdown) => dropdown
        .addOption("download_all", "Download available media")
        .addOption("download_images_only", "Download images only")
        .addOption("link_only", "Keep links only")
        .setValue(this.plugin.settings.defaultMediaPolicy)
        .onChange(async (value) => {
          this.plugin.settings.defaultMediaPolicy = value as AgentLensSettings["defaultMediaPolicy"];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Default note template")
      .setDesc("Default template saves source properties, content, tags, media and an editable Note section.")
      .addDropdown((dropdown) => dropdown
        .addOption("default", "Default template")
        .setValue(this.plugin.settings.defaultTemplateId)
        .onChange(async (value) => {
          this.plugin.settings.defaultTemplateId = value as AgentLensSettings["defaultTemplateId"];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Add platform tag")
      .setDesc("Add the normalized source platform to note tags.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.addPlatformTag).onChange(async (value) => {
        this.plugin.settings.addPlatformTag = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Add creator tag")
      .setDesc("Add a creator/<handle> tag when a stable creator name is available.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.addCreatorTag).onChange(async (value) => {
        this.plugin.settings.addCreatorTag = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Add media type tags")
      .setDesc("Add media/image, media/video, media/audio or media/file tags returned for the post.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.addMediaTags).onChange(async (value) => {
        this.plugin.settings.addMediaTags = value;
        await this.plugin.saveSettings();
      }));

    if (!SINGLE_FETCH_REVIEW) {
    new Setting(containerEl)
      .setName("Default Auto-Fetch frequency")
      .setDesc("Applies only to creators followed after this setting changes.")
      .addText((text) => text.setValue(String(this.plugin.settings.defaultAutoEvery)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.defaultAutoEvery = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.defaultAutoEvery;
        await this.plugin.saveSettings();
      }))
      .addDropdown((dropdown) => dropdown
        .addOption("hour", "Hour(s)")
        .addOption("day", "Day(s)")
        .addOption("week", "Week(s)")
        .setValue(this.plugin.settings.defaultAutoUnit)
        .onChange(async (value) => {
          this.plugin.settings.defaultAutoUnit = value === "week" ? "week" : value === "day" ? "day" : "hour";
          if (this.plugin.settings.defaultAutoUnit === "week") {
            this.plugin.settings.defaultAutoEvery = Math.min(12, this.plugin.settings.defaultAutoEvery);
          }
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Default daily time")
      .setDesc("Used for new once-a-day creators; existing schedules are not changed.")
      .addText((text) => text.setPlaceholder("09:00").setValue(this.plugin.settings.defaultAutoPreferredTime).onChange(async (value) => {
        this.plugin.settings.defaultAutoPreferredTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : DEFAULT_SETTINGS.defaultAutoPreferredTime;
        await this.plugin.saveSettings();
      }));

    }

    const diagnostics = new Setting(containerEl)
      .setName("Account and diagnostics")
      .setDesc(formatDiagnostics(this.plugin.diagnosticsSummarySnapshot()))
      .addButton((button) => button
        .setButtonText("Open AgentLens")
        .onClick(() => this.plugin.openWorkbench("single")))
      .addButton((button) => button
        .setButtonText("Copy diagnostics")
        .onClick(() => void this.plugin.copyDiagnostics()));
    void this.plugin.diagnosticsSummary().then(
      (summary) => diagnostics.setDesc(formatDiagnostics(summary)),
      () => diagnostics.setDesc("Privacy-safe diagnostics are temporarily unavailable. Tokens, paths and note content remain excluded.")
    );

  }
}

function formatDiagnostics(summary: DiagnosticsSummary): string {
  return `${summary.environment} · installation ${summary.shortInstallationId} · ${summary.pendingActions} pending action(s) · ${summary.ledgerEntries} ledger record(s). Tokens, paths and note content are excluded.`;
}
