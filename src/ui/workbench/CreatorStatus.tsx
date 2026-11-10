import { creatorStatus } from "./creatorStatusProjection";
import type { AutoFetchActivity } from "../../workbench/AutoFetchActivity";
import { userMessage } from "../../core/user-feedback";
import { creatorStatusDots } from "./creatorAssets";
import type { CreatorRecord } from "../../api/AgentLensApiClient";
import { useI18n } from "../../i18n/I18nProvider";

export function CreatorStatus({ creator }: { creator: CreatorRecord }) {
  const { t } = useI18n();
  const retryAt = creator.localStatus?.runState ? creator.localStatus.retryAt ?? null : creator.retryAt;
  return <div className="agentlens-creator-trace" aria-label={`Run trace for ${creator.displayName}`}>
    <div><strong>Frequency</strong><span>Every {creator.frequency.every} {creator.frequency.unit}{creator.frequency.every === 1 ? "" : "s"}</span></div>
    <div><strong>{t("creator.lastChecked")}</strong><span>{formatTimestamp(creator.lastSuccessfulCheckAt ?? null, "Never", true)}</span></div>
    <div><strong>{t("creator.nextCheck")}</strong><span>{formatTimestamp(creator.nextCheckAt, "Not scheduled")}</span></div>
    <div><strong>Last saved at</strong><span>{formatTimestamp(creator.lastSavedAt ?? null, "Never")}</span></div>
    <div><strong>Last saved</strong><span title={`Run ${creator.lastSavedFetchRunId ?? "—"}`}>{creator.lastSavedCount ?? 0}</span></div>
    <div><strong>Total saved</strong><span>{creator.importedCount}</span></div>
    {retryAt && <div className="is-retry"><strong>{t("creator.retryAt")}</strong><span>{formatTimestamp(retryAt, "—")}</span></div>}
  </div>;
}

function formatTimestamp(value: string | null, fallback: string, relative = false): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const now = new Date();
  const minutes = Math.floor((now.getTime() - parsed.getTime()) / 60000);
  if (relative && minutes >= 0 && minutes < 60) return minutes < 1 ? "Just now" : `${minutes} min ago`;
  const time = parsed.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", hour12: false});
  return parsed.toDateString() === now.toDateString() ? `Today ${time}` : `${parsed.toLocaleDateString()} ${time}`;
}


export function CreatorBadge({creator, activity, pendingSync = false}: {creator: CreatorRecord; activity?: AutoFetchActivity | undefined; pendingSync?: boolean}) {
  const status = creatorStatus(creator, activity);
  const label = pendingSync ? "Pending sync" : status.label;
  return <span className={`agentlens-creator-badge is-${status.kind}`} data-main-status={status.mainStatus}
    data-sub-status={status.subStatus} title={status.mainStatus === "failed" && (creator.localStatus?.lastError ?? creator.lastError) ? userMessage(creator.localStatus?.lastError ?? creator.lastError!) : label}>
    <img src={creatorStatusDots[status.kind]} width="7" height="7" alt="" />{label}
  </span>;
}
