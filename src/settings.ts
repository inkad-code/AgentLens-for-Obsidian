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
  agentlensSettings: AgentLensSettings;
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

  getSettingDefinitions(): Array<{
    name: string;
    render: (setting: Setting) => void;
  }> {
    const definitions: Array<{
      name: string;
      render: (setting: Setting) => void;
    }> = [];

    definitions.push({
      name: "Plugin version",
      render: (setting) => {
        setting
          .setName("Plugin version")
          .setDesc(
            `${this.plugin.manifest.version} · updates are installed through Obsidian Community Plugins`,
          );
      },
    });
    if (!SINGLE_FETCH_REVIEW) {
      definitions.push({
        name: "Language",
        render: (setting) => {
          setting
            .setName("Language")
            .setDesc("Language used in the AgentLens workbench.")
            .addDropdown((dropdown) =>
              dropdown
                .addOption("en", "English")
                .addOption("zh-CN", "简体中文")
                .addOption("zh-TW", "繁體中文")
                .setValue(this.plugin.agentlensSettings.locale)
                .onChange(async (value) => {
                  this.plugin.agentlensSettings.locale = resolveLocale(value);
                  await this.plugin.saveSettings();
                }),
            );
        },
      });
    }
    definitions.push({
      name: "Default note folder",
      render: (setting) => {
        setting
          .setName("Default note folder")
          .setDesc(
            "Vault-relative folder used for new saves. Each save can override it.",
          )
          .addText((text) =>
            text
              .setPlaceholder("AgentLens/Inbox")
              .setValue(this.plugin.agentlensSettings.defaultFolderPath)
              .onChange(async (value) => {
                this.plugin.agentlensSettings.defaultFolderPath =
                  safeFolderPath(value);
                await this.plugin.saveSettings();
              }),
          );
      },
    });
    definitions.push({
      name: "Default media policy",
      render: (setting) => {
        setting
          .setName("Default media policy")
          .setDesc(
            "Large or unavailable media can still fall back to links and a partial note.",
          )
          .addDropdown((dropdown) =>
            dropdown
              .addOption("download_all", "Download available media")
              .addOption("download_images_only", "Download images only")
              .addOption("link_only", "Keep links only")
              .setValue(this.plugin.agentlensSettings.defaultMediaPolicy)
              .onChange(async (value) => {
                this.plugin.agentlensSettings.defaultMediaPolicy =
                  value as AgentLensSettings["defaultMediaPolicy"];
                await this.plugin.saveSettings();
              }),
          );
      },
    });
    definitions.push({
      name: "Default note template",
      render: (setting) => {
        setting
          .setName("Default note template")
          .setDesc(
            "Default template saves source properties, content, tags, media and an editable note section.",
          )
          .addDropdown((dropdown) =>
            dropdown
              .addOption("default", "Default template")
              .setValue(this.plugin.agentlensSettings.defaultTemplateId)
              .onChange(async (value) => {
                this.plugin.agentlensSettings.defaultTemplateId =
                  value as AgentLensSettings["defaultTemplateId"];
                await this.plugin.saveSettings();
              }),
          );
      },
    });
    definitions.push({
      name: "Add platform tag",
      render: (setting) => {
        setting
          .setName("Add platform tag")
          .setDesc("Add the normalized source platform to note tags.")
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.agentlensSettings.addPlatformTag)
              .onChange(async (value) => {
                this.plugin.agentlensSettings.addPlatformTag = value;
                await this.plugin.saveSettings();
              }),
          );
      },
    });
    definitions.push({
      name: "Add creator tag",
      render: (setting) => {
        setting
          .setName("Add creator tag")
          .setDesc(
            "Add a creator/<handle> tag when a stable creator name is available.",
          )
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.agentlensSettings.addCreatorTag)
              .onChange(async (value) => {
                this.plugin.agentlensSettings.addCreatorTag = value;
                await this.plugin.saveSettings();
              }),
          );
      },
    });
    definitions.push({
      name: "Add media type tags",
      render: (setting) => {
        setting
          .setName("Add media type tags")
          .setDesc(
            "Add media/image, media/video, media/audio or media/file tags returned for the post.",
          )
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.agentlensSettings.addMediaTags)
              .onChange(async (value) => {
                this.plugin.agentlensSettings.addMediaTags = value;
                await this.plugin.saveSettings();
              }),
          );
      },
    });
    if (!SINGLE_FETCH_REVIEW) {
      definitions.push({
        name: "Default Auto-Fetch frequency",
        render: (setting) => {
          setting
            .setName("Default Auto-Fetch frequency")
            .setDesc(
              "Applies only to creators followed after this setting changes.",
            )
            .addText((text) =>
              text
                .setValue(
                  String(this.plugin.agentlensSettings.defaultAutoEvery),
                )
                .onChange(async (value) => {
                  const parsed = Number.parseInt(value, 10);
                  this.plugin.agentlensSettings.defaultAutoEvery =
                    Number.isFinite(parsed) && parsed > 0
                      ? parsed
                      : DEFAULT_SETTINGS.defaultAutoEvery;
                  await this.plugin.saveSettings();
                }),
            )
            .addDropdown((dropdown) =>
              dropdown
                .addOption("hour", "Hour(s)")
                .addOption("day", "Day(s)")
                .addOption("week", "Week(s)")
                .setValue(this.plugin.agentlensSettings.defaultAutoUnit)
                .onChange(async (value) => {
                  this.plugin.agentlensSettings.defaultAutoUnit =
                    value === "week"
                      ? "week"
                      : value === "day"
                        ? "day"
                        : "hour";
                  if (
                    this.plugin.agentlensSettings.defaultAutoUnit === "week"
                  ) {
                    this.plugin.agentlensSettings.defaultAutoEvery = Math.min(
                      12,
                      this.plugin.agentlensSettings.defaultAutoEvery,
                    );
                  }
                  await this.plugin.saveSettings();
                }),
            );
        },
      });
      definitions.push({
        name: "Default daily time",
        render: (setting) => {
          setting
            .setName("Default daily time")
            .setDesc(
              "Used for new once-a-day creators; existing schedules are not changed.",
            )
            .addText((text) =>
              text
                .setPlaceholder("09:00")
                .setValue(
                  this.plugin.agentlensSettings.defaultAutoPreferredTime,
                )
                .onChange(async (value) => {
                  this.plugin.agentlensSettings.defaultAutoPreferredTime =
                    /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
                      ? value
                      : DEFAULT_SETTINGS.defaultAutoPreferredTime;
                  await this.plugin.saveSettings();
                }),
            );
        },
      });
    }
    definitions.push({
      name: "Account and diagnostics",
      render: (setting) => {
        const diagnostics = setting
          .setName("Account and diagnostics")
          .setDesc(formatDiagnostics(this.plugin.diagnosticsSummarySnapshot()))
          .addButton((button) =>
            button
              .setButtonText("Open AgentLens")
              .onClick(() => this.plugin.openWorkbench("single")),
          )
          .addButton((button) =>
            button
              .setButtonText("Copy diagnostics")
              .onClick(() => void this.plugin.copyDiagnostics()),
          );
        void this.plugin.diagnosticsSummary().then(
          (summary) => diagnostics.setDesc(formatDiagnostics(summary)),
          () =>
            diagnostics.setDesc(
              "Privacy-safe diagnostics are temporarily unavailable. Tokens, paths and note content remain excluded.",
            ),
        );
      },
    });

    return definitions;
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("AgentLens").setHeading();
    for (const definition of this.getSettingDefinitions()) {
      if ("render" in definition && definition.render) {
        // Legacy host rendering uses the same controls and persistence callbacks.
        definition.render(new Setting(this.containerEl));
      }
    }
  }
}

function formatDiagnostics(summary: DiagnosticsSummary): string {
  return `${summary.environment} · installation ${summary.shortInstallationId} · ${summary.pendingActions} pending action(s) · ${summary.ledgerEntries} ledger record(s). Tokens, paths and note content are excluded.`;
}
