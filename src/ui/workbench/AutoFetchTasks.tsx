import { EmptyStateIllustration } from "./EmptyStateIllustration";
import { BackToTop } from "./BackToTop";
import { useEffect, useRef, useState } from "react";
import type { AutoFetchWorkbenchPort } from "../../workbench/ports";
import { importStatus, matchesImportTask, taskActive, taskVisibleInHistory, type ImportTask, type ImportNote, type ImportFile, type ImportPhase, type ImportTaskFilter, type ImportTaskPage } from "../../workbench/ImportTasks";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/catalog";
import { useHostWindow } from "./HostDocument";
import { RemoteThumbnail, PlatformIcon, message } from "./shared";
import success from "./assets/tasks/success.svg";
import statusSuccess from "./assets/tasks/status-success.svg";
import statusForward from "./assets/tasks/status-forward.svg";
import failed from "./assets/tasks/failed.svg";
import skipped from "./assets/tasks/skipped.svg";
import spinner from "./assets/tasks/spinner.svg";
import back from "./assets/tasks/back.svg";
import chevron from "./assets/tasks/chevron.svg";

export function useImportTasks(service: AutoFetchWorkbenchPort | undefined, signedIn: boolean, accountId?: string) {
  const [tasks, setTasks] = useState<readonly ImportTask[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const current = ++generation.current;
    setTasks([]); setError(undefined); setLoading(Boolean(service?.importTasks && signedIn));
    if (!service?.importTasks || !signedIn) return;
    let running = false, dirty = false;
    const read = async () => {
      if (running) { dirty = true; return; }
      running = true;
      try {
        do {
          dirty = false;
          const value = await service.importTasks!();
          if (current === generation.current) { setTasks(value); setError(undefined); }
        } while (dirty && current === generation.current);
      } catch (caught) { if (current === generation.current) { setTasks([]); setError(message(caught)); } }
      finally { running = false; if (current === generation.current) setLoading(false); }
    };
    const unsubscribe = service.subscribeImportTasks?.(() => { void read(); });
    void read();
    return () => { generation.current++; unsubscribe?.(); };
  }, [service, signedIn, refresh, accountId]);
  return { tasks, error, loading, refresh: () => setRefresh(value => value + 1) };
}

export function AutoFetchImportStatus({ tasks, loading, error, onClick }: {
  tasks: readonly ImportTask[]; loading: boolean; error?: string | undefined; onClick: () => void;
}) {
  const { t } = useI18n();
  const window = useHostWindow();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, [window]);
  const visibleTasks = tasks.filter(taskVisibleInHistory);
  const status = importStatus(visibleTasks, now);
  const text = t(loading ? "tasks.loading" : error || !visibleTasks.length ? "tasks.history"
    : status === "importing" ? "tasks.importing" : status === "failed" ? "tasks.failed" : "tasks.completed");
  return <button type="button" className={`agentlens-auto-import-status is-${status}`} onClick={onClick}>
    <span className="agentlens-auto-import-icon" aria-hidden="true"><img src={status === "importing" ? spinner : status === "failed" ? failed : statusSuccess} alt="" /></span>
    <span className="agentlens-auto-import-label">{` ${text}`}</span><img src={statusForward} alt="" />
  </button>;
}

function Progress({ value, label }: { value?: number | undefined; label: string }) {
  return <div className={`agentlens-task-progress${value === undefined ? " is-indeterminate" : ""}`} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}>
    <i style={{ width: value === undefined ? "30%" : `${Math.max(0, Math.min(1, value)) * 100}%` }} />
  </div>;
}
function bytes(value: number): string { return value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`; }
const labels: Record<ImportPhase, TranslationKey> = { checking: "tasks.checking", downloading: "tasks.downloading", saving: "tasks.saving", saved: "tasks.saved",
  skipped: "tasks.skipped", linked: "tasks.linked", failed: "tasks.fileFailed", cancelled: "tasks.cancelled", waiting: "tasks.waiting" };
const settled = (phase: ImportPhase) => ["saved", "skipped", "linked", "failed", "cancelled"].includes(phase);
function counts(task: ImportTask) {
  const files = task.notes.flatMap(note => note.files);
  return { total: files.length, finished: files.filter(file => settled(file.phase)).length,
    saved: files.filter(file => file.phase === "saved").length,
    failed: files.filter(file => file.phase === "failed").length,
    skipped: files.filter(file => ["skipped", "linked", "cancelled"].includes(file.phase)).length };
}

function TaskCard({ task, busy, onAction }: { task: ImportTask; busy: boolean; onAction: (task: ImportTask) => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [filePage, setFilePage] = useState(0);
  const active = taskActive(task);
  const count = counts(task);
  const creator = task.notes[0]?.preview.post;
  const platform = task.platform ?? creator?.platform;
  const emptyCheck = task.phase === "saved" && task.notes.length === 0;
  const handle = task.handle ?? creator?.author.handle ?? platform;
  const fetchError = task.fetchError ?? (task.phase === "failed" && !task.notes.length ? task.error : undefined);
  const entries = task.notes.flatMap<{ note: ImportNote; file: ImportFile | undefined }>(note => note.files.length ? note.files.map(file => ({ note, file })) : [{ note, file: undefined }]);
  const groups = new Map<ImportTask["notes"][number], typeof entries>();
  for (const entry of entries.slice(filePage * 50, (filePage + 1) * 50)) groups.set(entry.note, [...(groups.get(entry.note) ?? []), entry]);
  return <article className={`agentlens-task-card${active ? " is-importing" : ""}${open ? " is-expanded" : ""}`}>
    <div className="agentlens-task-top">
      <div className="agentlens-task-creator"><RemoteThumbnail url={task.avatarUrl} kind="Creator" /><div><strong title={task.creatorName}>{task.creatorName}</strong>
        {platform && <span><PlatformIcon id={platform} variant="creator" /><small title={handle}>{handle}</small></span>}</div></div>
      <div className="agentlens-task-destination"><div><span>{t("tasks.saveTo")}</span><strong title={task.folderPath}>{task.folderPath}</strong></div>
        {active && <Progress label={t("tasks.taskProgress")} value={count.total ? count.finished / count.total : undefined} />}</div>
      <div className="agentlens-task-actions">
        {active ? <span className="agentlens-task-total">{count.finished} / {count.total || "—"}</span> : <>
          {count.saved > 0 && <span className="agentlens-task-badge is-success"><img src={success} alt="" />{t("tasks.importedCount", { count: count.saved })}</span>}
          {count.skipped > 0 && <span className="agentlens-task-badge is-skipped"><img src={skipped} alt="" />{t("tasks.skippedCount", { count: count.skipped })}</span>}
          {count.failed > 0 && <span className="agentlens-task-badge is-failed"><img src={failed} alt="" />{t("tasks.failedCount", { count: count.failed })}</span>}
          {!fetchError || count.total > 0 ? <span className="agentlens-task-total">{t(emptyCheck ? "tasks.newPosts" : count.total === 0 && task.notes.length > 0 ? "tasks.notes" : "tasks.total", { count: emptyCheck ? 0 : count.total || task.notes.length })}</span> : null}
        </>}
        {fetchError && <span className="agentlens-task-badge is-failed"><img src={failed} alt="" />{t("tasks.fetchFailed")}</span>}
        <button type="button" disabled={busy} onClick={() => onAction(task)}>{t(active ? "tasks.cancel" : "tasks.retry")}</button>
      </div>
    </div>
    <div className="agentlens-task-context"><div><span>{t("tasks.requestId")}: {task.requestId}</span><span>{t("tasks.credits", { count: task.credits ?? "—" })}</span><time dateTime={task.time}>{new Date(task.time).toLocaleString(locale)}</time></div>
      <button type="button" aria-expanded={open} aria-controls={`task-files-${task.id}`} onClick={() => setOpen(value => !value)}>{t("tasks.detail")}<img className={open ? "is-open" : ""} src={chevron} alt="" /></button></div>
    {(emptyCheck || (task.phase !== "saved" && !fetchError)) && <p className="agentlens-task-muted agentlens-task-summary">
      {emptyCheck ? t("tasks.emptyCheck") : <>{t(labels[task.phase])}{task.notes.length > 0 && <> · {t("tasks.notesSaved", {
        saved: task.notes.filter(note => note.phase === "saved" || note.phase === "skipped").length, total: task.notes.length
      })}</>}</>}
    </p>}
    {task.error && !fetchError && <p className="agentlens-inline-error">{task.error}</p>}
    {open && <div className="agentlens-task-files" id={`task-files-${task.id}`}>
      {fetchError && <div className="agentlens-task-file"><div><strong>{t("tasks.parseError")}</strong><p className="agentlens-inline-error">{fetchError}</p></div></div>}
      {[...groups].map(([note, items]) => <section key={note.key} className={`agentlens-task-note${note.files.length ? "" : " is-text-only"}`}><div className="agentlens-task-note-heading"><span title={note.path}>{t("tasks.note")}: {note.path}</span><span>{t(labels[note.phase])}</span></div>
        {items.map(({ file }) => file && <div className="agentlens-task-file" key={file.id}><div><span title={file.name}>{file.name.split(/[\\/]/).at(-1)}</span>
          {file.phase === "downloading" && <Progress label={t("tasks.fileProgress", { name: file.name })} value={file.totalBytes ? file.receivedBytes / file.totalBytes : undefined} />}
          {file.error && <p className="agentlens-inline-error">{file.error}</p>}</div><div className="agentlens-task-file-state">
          {file.phase === "downloading" ? <><span>{bytes(file.receivedBytes)} / {file.totalBytes === undefined ? "—" : bytes(file.totalBytes)}</span>
            <span>{file.totalBytes ? `${Math.round(file.receivedBytes / file.totalBytes * 100)}%` : t("tasks.unknownSize")}</span></> : <span className={`agentlens-task-badge ${file.phase === "failed" ? "is-failed" : ["skipped", "linked", "cancelled"].includes(file.phase) ? "is-skipped" : file.phase === "saved" ? "is-success" : ""}`}>{t(labels[file.phase])}</span>}
        </div></div>)}
      </section>)}
      {!task.notes.length && !fetchError && <p className="agentlens-task-muted">{t(active ? "tasks.checking" : emptyCheck ? "tasks.noNewPosts" : "tasks.noContent")}</p>}
      {entries.length > 50 && <div className="agentlens-task-actions agentlens-task-file-pagination">
        {filePage > 0 && <button type="button" onClick={() => setFilePage(0)}>{t("tasks.back")}</button>}
        <button type="button" disabled={(filePage + 1) * 50 >= entries.length} onClick={() => setFilePage(value => value + 1)}>{t("tasks.more")}</button>
      </div>}
    </div>}
  </article>;
}

function useTaskHistory(service: AutoFetchWorkbenchPort | undefined, owner: string | undefined, filter: ImportTaskFilter) {
  const [page, setPage] = useState<ImportTaskPage>();
  const [scope, setScope] = useState<{ service: AutoFetchWorkbenchPort | undefined; owner: string | undefined; filter: ImportTaskFilter }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setPage(undefined); setError(undefined); setScope({ service, owner, filter }); pending.current = false;
    if (!service?.importTaskHistory) { setLoading(false); return; }
    setLoading(true); pending.current = true;
    void service.importTaskHistory(undefined, filter).then(value => {
      if (current === generation.current) setPage(value);
    }, caught => { if (current === generation.current) setError(message(caught, "read_only")); }).finally(() => {
      if (current === generation.current) { pending.current = false; setLoading(false); }
    });
    return () => { generation.current++; };
  }, [service, owner, filter, reload]);
  async function more() {
    if (pending.current || !page?.nextCursor || !service?.importTaskHistory) return false;
    const current = generation.current;
    pending.current = true; setLoading(true); setError(undefined);
    try {
      const value = await service.importTaskHistory(page.nextCursor, filter);
      if (current === generation.current) {
        setPage(previous => ({ tasks: [...(previous?.tasks ?? []), ...value.tasks], nextCursor: value.nextCursor }));
        return true;
      }
    } catch (caught) { if (current === generation.current) setError(message(caught, "read_only")); }
    finally { if (current === generation.current) { pending.current = false; setLoading(false); } }
    return false;
  }
  const currentScope = scope?.service === service && scope?.owner === owner && scope?.filter === filter;
  return { page: currentScope ? page : undefined, loading, error: currentScope ? error : undefined, more, refresh: () => setReload(value => value + 1) };
}

export function AutoFetchTasks({ tasks, loading, error, service, onBack, onRefresh }: {
  tasks: readonly ImportTask[]; loading: boolean; error?: string | undefined; service?: AutoFetchWorkbenchPort | undefined;
  onBack: () => void; onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ImportTaskFilter>("all");
  const owner = tasks[0] ? JSON.stringify([tasks[0].accountId, tasks[0].installationId]) : undefined;
  const history = useTaskHistory(service, owner, filter);
  const observed = useRef({ owner, tasks: new Map<string, ImportTask>() });
  if (observed.current.owner !== owner) observed.current = { owner, tasks: new Map() };
  for (const task of tasks) observed.current.tasks.set(task.id, task);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string>();
  const pending = useRef(new Set<string>());
  async function act(task: ImportTask) {
    if (pending.current.has(task.id)) return;
    pending.current.add(task.id); setBusy(new Set(pending.current)); setActionError(undefined);
    try {
      if (taskActive(task)) {
        if (!service?.cancelImportTask) throw new Error("Task cancellation is unavailable. Update the plugin.");
        await service.cancelImportTask(task.id);
      } else {
        if (!service?.retryImportTask) throw new Error("Task retry is unavailable. Update the plugin.");
        await service.retryImportTask(task.id);
      }
    } catch (caught) { setActionError(caught instanceof Error && caught.message === "This task has no failed files to retry." ? t("tasks.noRetry") : message(caught)); }
    finally { pending.current.delete(task.id); setBusy(new Set(pending.current)); }
  }
  // Retain live completion facts when a task later leaves the recent window.
  // An older cached history page must not resurrect an empty finished check.
  const archived = (history.page?.tasks ?? []).map(task => observed.current.tasks.get(task.id) ?? task);
  const merged = [...new Map([...archived, ...tasks].map(task => [task.id, task])).values()]
    .sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
  const active = tasks.filter(taskActive);
  const visible = merged.filter(task => matchesImportTask(task, filter));
  const totals = active.map(counts);
  const total = totals.reduce((sum, task) => sum + task.total, 0);
  const finished = totals.reduce((sum, task) => sum + task.finished, 0);
  return <section className="agentlens-import-tasks" aria-label={t("tasks.title")}>
    <header className="agentlens-tasks-toolbar"><button type="button" onClick={onBack}><img src={back} alt="" />{t("tasks.back")}</button>
      <div role="tablist" aria-label={t("tasks.filterLabel")}>{(["all", "importing", "completed", "failed"] as const).map(value => <button type="button" key={value} role="tab" aria-selected={filter === value} onClick={() => { setFilter(value); setLimit(50); }}>{t(({ all: "tasks.all", importing: "tasks.importing", completed: "tasks.completedTab", failed: "tasks.failedTab" } as const)[value])}</button>)}</div></header>
    {(filter === "all" || filter === "importing") && active.length > 0 && <section className="agentlens-tasks-overall"><div><div className="agentlens-tasks-overall-copy"><img src={spinner} alt="" /><div><h2>{t("tasks.overallTitle")}</h2><p>{t("tasks.overallHint")}</p></div></div>
      <div className="agentlens-task-actions"><span className="agentlens-task-total">{total ? `${Math.round(finished / total * 100)}%` : "—"}</span><button type="button" disabled={busy.size > 0} onClick={() => { void (async () => { for (const task of active) await act(task); })(); }}>{t("tasks.cancelAll")}</button></div></div>
      <Progress label={t("tasks.overallProgress")} value={total ? finished / total : undefined} /></section>}
    {(actionError || error || history.error) && <p role="alert" className="agentlens-inline-error">{actionError || error || history.error}<button type="button" onClick={() => { onRefresh(); history.refresh(); }}>{t("tasks.refresh")}</button></p>}
    {loading || (history.loading && !visible.length) ? <p role="status">{t("tasks.loading")}</p> : !visible.length && <div className="agentlens-tasks-empty"><EmptyStateIllustration /><h2>{t("tasks.empty")}</h2></div>}
    <div className="agentlens-tasks-list">{visible.slice(0, limit).map(task => <TaskCard key={task.id} task={task} busy={busy.has(task.id)} onAction={task => { void act(task); }} />)}</div>
    {visible.length > 0 && <BackToTop variant="tasks" />}
    {(visible.length > limit || history.page?.nextCursor) && <button type="button" className="agentlens-tasks-more" disabled={history.loading}
      onClick={() => { if (visible.length > limit) setLimit(value => value + 50); else void history.more().then(loaded => { if (loaded) setLimit(value => value + 50); }); }}>{t(history.loading ? "tasks.loadingMore" : "tasks.more")}</button>}
  </section>;
}
