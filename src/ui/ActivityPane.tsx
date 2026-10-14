import { userMessage } from "../core/user-feedback";
import { useHostDocument } from "./workbench/HostDocument";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityDetail, ActivityFilters, ActivityOperation, ActivityResult, ActivitySummary } from "../api/AgentLensApiClient";
import type { ActivityWorkbenchPort } from "../workbench/ports";
import { BackToTop } from "./workbench/BackToTop";
import { useI18n } from "../i18n/I18nProvider";
import type { TranslationKey } from "../i18n/catalog";

export function ActivityPane({ service, onBack }: {
  service: ActivityWorkbenchPort;
  onBack: () => void;
}) {
  const document = useHostDocument();
  const { t } = useI18n();
  const [operation, setOperation] = useState<ActivityOperation | "all">("all");
  const [result, setResult] = useState<ActivityResult | "all">("all");
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [items, setItems] = useState<readonly ActivitySummary[]>([]);
  const [through, setThrough] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [retainedFrom, setRetainedFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ActivityDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const queryRevision = useRef(0);

  const filters = useMemo<ActivityFilters>(() => ({
    ...(operation === "all" ? {} : { operation }),
    ...(result === "all" ? {} : { result }),
    from: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  }), [operation, result, days]);

  useEffect(() => {
    const revision = ++queryRevision.current;
    let active = true;
    setBusy(true);
    setError(null);
    setSelected(null);
    void service.activity(filters).then(
      (page) => {
        if (!active || revision !== queryRevision.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setThrough(page.through);
        setRetainedFrom(page.retainedFrom);
      },
      (failure) => {
        if (!active || revision !== queryRevision.current) return;
        setItems([]);
        setNextCursor(null);
        setError(message(failure));
      }
    ).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [service, filters]);

  async function loadMore() {
    if (!nextCursor || moreBusy) return;
    const revision = queryRevision.current;
    setMoreBusy(true);
    setError(null);
    try {
      const page = await service.activity(filters, nextCursor, through);
      if (revision !== queryRevision.current) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.activityId));
        const additions = page.items.filter((item) => {
          if (seen.has(item.activityId)) return false;
          seen.add(item.activityId);
          return true;
        });
        return Object.freeze([...current, ...additions]);
      });
      setNextCursor(page.nextCursor);
    } catch (failure) {
      if (revision === queryRevision.current) setError(message(failure));
    } finally {
      setMoreBusy(false);
    }
  }

  async function openDetail(activityId: string) {
    const revision = queryRevision.current;
    setDetailBusy(true);
    setError(null);
    try {
      const detail = await service.activityDetail(activityId);
      if (revision === queryRevision.current) setSelected(detail);
    } catch (failure) {
      if (revision === queryRevision.current) setError(message(failure));
    } finally {
      setDetailBusy(false);
    }
  }

  async function exportJson() {
    const revision = queryRevision.current;
    setExportBusy(true);
    setError(null);
    try {
      const payload = await service.exportActivity(filters);
      if (revision !== queryRevision.current) return;
      const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "agentlens-obsidian-activity.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (failure) {
      if (revision === queryRevision.current) setError(message(failure));
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <main className="agentlens-activity" aria-label="Activity history">
      <header className="agentlens-pane-heading agentlens-activity__heading">
        <div><p className="agentlens-eyebrow">READ-ONLY HISTORY</p><h2>Activity</h2><p>Authoritative AgentLens executions for this account and Obsidian installation.</p></div>
        <div className="agentlens-activity__actions">
          <button type="button" onClick={onBack}>Back to workflows</button>
          <button type="button" onClick={() => void exportJson()} disabled={exportBusy || busy}>{exportBusy ? "Exporting…" : "Export JSON"}</button>
        </div>
      </header>

      <section className="agentlens-activity__filters" aria-label="Activity filters">
        <label>Operation<select aria-label="Activity operation" value={operation} onChange={(event) => setOperation(event.target.value as ActivityOperation | "all")}><option value="all">All operations</option><option value="single_fetch">Single Fetch</option><option value="profile_bulk_fetch">Profile Bulk Fetch</option><option value="auto_fetch">Auto-Fetch</option><option value="creator_settings">{t("activity.creatorSettings")}</option><option value="creator_pause">{t("activity.creatorPause")}</option><option value="creator_resume">{t("activity.creatorResume")}</option><option value="creator_delete">{t("activity.creatorDelete")}</option></select></label>
        <label>Result<select aria-label="Activity result" value={result} onChange={(event) => setResult(event.target.value as ActivityResult | "all")}><option value="all">All results</option><option value="success">Success</option><option value="partial">Partial</option><option value="failed">Failed</option></select></label>
        <label>Time range<select aria-label="Activity time range" value={days} onChange={(event) => setDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
      </section>

      {retainedFrom && <p className="agentlens-muted">Server retention: 90 days · retained from {formatDate(retainedFrom)}</p>}
      {error && <section className="agentlens-readonly-error" role="alert"><strong>Activity could not be read</strong><span>{error}</span><span>No fetch, retry, usage or scheduler action was started.</span></section>}
      {busy ? <div className="agentlens-empty-state" role="status">Loading authoritative activity…</div>
        : items.length === 0 ? <div className="agentlens-empty-state"><strong>No activity for these filters</strong><span>New Single, Profile Bulk and Auto-Fetch executions will appear here.</span></div>
          : <div className="agentlens-activity__layout">
            <div className="agentlens-activity__list" aria-label="Activity records">
              {items.map((item) => <article key={item.activityId} className={`agentlens-activity-row is-${item.result}`}>
                <div><strong>{operationLabel(item.operation, t)}</strong><span>{item.platform ?? "Unknown platform"} · {item.targetAlias ?? "Public source"}</span></div>
                <div><strong>{resultLabel(item.result)}{item.deleted ? " · Deleted instance" : ""}</strong><span>{formatDate(item.occurredAt)} · {item.chargedUnits} charged</span></div>
                <div><strong>{item.relativeNotePath ?? "No Vault receipt"}</strong><span>{item.fileCount} file{item.fileCount === 1 ? "" : "s"}</span></div>
                <button type="button" onClick={() => void openDetail(item.activityId)} disabled={detailBusy}>Details</button>
              </article>)}
              {nextCursor && <button type="button" className="agentlens-activity__more" onClick={() => void loadMore()} disabled={moreBusy}>{moreBusy ? "Loading…" : "Load more"}</button>}
            </div>
            {selected && <ActivityDetailPanel detail={selected} onClose={() => setSelected(null)} />}
          </div>}
      <BackToTop />
    </main>
  );
}

function ActivityDetailPanel({ detail, onClose }: { detail: ActivityDetail; onClose: () => void }) {
  const diagnosticRows = [
    ["request", shortId(detail.diagnostics.requestId)],
    ["fetch", shortId(detail.diagnostics.fetchId)],
    ["run", shortId(detail.diagnostics.runId)],
    ["cursor ref", detail.diagnostics.cursorRef],
    ["page", detail.diagnostics.pageNumber?.toString() ?? null],
    ["trigger", detail.diagnostics.trigger],
    ["usage", `${detail.diagnostics.chargedUnits} charged`],
    ["dedupe", detail.diagnostics.reusedExisting ? "reused_existing" : "new result"],
    ["error", detail.diagnostics.errorCode],
    ["summary", detail.diagnostics.errorSummary]
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return <aside className="agentlens-activity-detail" aria-label="Activity diagnostics">
    <div><h3>Diagnostics</h3><button type="button" aria-label="Close activity details" onClick={onClose}>Close</button></div>
    <p>Controlled support fields only. IDs are shortened in the UI.</p>
    <dl>{diagnosticRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </aside>;
}

function operationLabel(value: ActivityOperation, t: (key: TranslationKey) => string): string {
  if (value === "single_fetch") return "Single Fetch";
  if (value === "profile_bulk_fetch") return "Profile Bulk Fetch";
  if (value === "auto_fetch") return "Auto-Fetch";
  if (value === "creator_settings") return t("activity.creatorSettings");
  if (value === "creator_pause") return t("activity.creatorPause");
  if (value === "creator_resume") return t("activity.creatorResume");
  return t("activity.creatorDelete");
}

function resultLabel(value: ActivityResult): string {
  return value === "success" ? "Success" : value === "partial" ? "Partial" : "Failed";
}

function shortId(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function message(error: unknown): string {
  return userMessage(error, "read_only");
}
