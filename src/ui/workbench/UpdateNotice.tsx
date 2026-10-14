import type { AccountCapabilities } from "../../api/contracts";
import { versionAtLeast } from "../../core/versions";
import { useI18n } from "../../i18n/I18nProvider";

export function UpdateNotice({
  currentVersion,
  capabilities,
  dismissedVersion,
  preferencesLoaded,
  onDismiss
}: {
  currentVersion: string;
  capabilities: AccountCapabilities;
  dismissedVersion?: string | undefined;
  preferencesLoaded: boolean;
  onDismiss: (version: string) => void;
}) {
  const { t } = useI18n();
  const required = !versionAtLeast(currentVersion, capabilities.minimumPluginVersion);
  const available = !versionAtLeast(currentVersion, capabilities.latestPluginVersion);
  if (!required && (!preferencesLoaded || !available || dismissedVersion === capabilities.latestPluginVersion)) return null;
  const title = t(required ? "update.required.title" : "update.available.title");
  return <section
    className={`agentlens-update-notice ${required ? "is-required" : "is-optional"}`}
    role={required ? "alert" : "status"}
    aria-label={title}
  >
    <div><strong>{title}</strong><span>{t(required ? "update.required.body" : "update.available.body", {
      version: required ? capabilities.minimumPluginVersion : capabilities.latestPluginVersion
    })}</span>{required && <span>Local settings and saved notes remain available.</span>}</div>
    <a href={capabilities.releaseNotesUrl} target="_blank" rel="noreferrer">{t("update.releaseNotes")}</a>
    <a href={capabilities.supportUrl} target="_blank" rel="noreferrer">{t("update.install")}</a>
    {!required && <button type="button" onClick={() => onDismiss(capabilities.latestPluginVersion)}>{t("update.dismiss")}</button>}
  </section>;
}
