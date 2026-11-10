import { EmptyStateIllustration } from "./EmptyStateIllustration";
import { isPinterestGuidance } from "../../core/pinterest-board";
import { AgentLensError } from "../../core/errors";
import type { SyntheticEvent } from "react";
import { PostPreviewDocument } from "./PostPreviewDocument";
import previewClose from "./assets/preview/close.svg";
import previewSpinner from "./assets/tasks/spinner.svg";
import type { CSSProperties } from "react";
import { mediaControlStyle } from "./singleControlAssets";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { BatchSaveView, type BatchSaveEntry } from "./BatchSaveView";
import { bulkAssets, bulkCheckboxSelected } from "./bulkAssets";
import { FolderField } from "./FolderField";
import { useEffect, useId, useRef, useState } from "react";
import type { NoteWriteManifest } from "../../vault/VaultWriter";
import { plannedDownloadCount } from "./savePresentation";
import type { BatchSaveResult, PreviewResult, SaveTransferProgress } from "../../workbench/types";
import type { BulkWorkbenchPort } from "../../workbench/ports";
import { BulkSession } from "../../bulk/BulkSession";
import { postListTitle, postListSummary, postThumbnailUrl, contentKey } from "../../core/domain";
import type { MediaPolicy } from "../../core/domain";
import type { AccountCapabilities } from "../../api/contracts";
import { publicLinkFromText } from "../../core/urls";
import type { TemplateId, WorkbenchDefaults } from "./types";
import { RemoteThumbnail, mediaCounts, message, operationAvailable } from "./shared";
import { BackToTop } from "./BackToTop";
import { WorkflowOnboarding } from "./WorkflowOnboarding";
import { BULK_DEMO_LINK } from "./demoLinks";
import { useI18n } from "../../i18n/I18nProvider";

type BulkWriteOptions = { folderPath: string; mediaPolicy: MediaPolicy; templateId: TemplateId; saveAsCopy: true };

const listingOnlyPreviewPlatforms = new Set(["youtube", "bilibili"]);
const inlineSupplementPlatforms = new Set(["xiaohongshu", "weibo"]);

export function BulkFetchPane({
  onDemoSaved,
  onRequestSignUp,
  onStartFree,
  service,
  signedIn,
  capabilities,
  onOpenNote,
  defaults,
  onDraftChange,
  onAccountChanged,
  onSaveViewChange,
  navigationVersion = 0,
  active: isActive = true
}: {
  service?: BulkWorkbenchPort | undefined;
  signedIn: boolean;
  onDemoSaved?: (()=>void) | undefined;
  onRequestSignUp?: (()=>void) | undefined;
  onStartFree?: (()=>void) | undefined;
  capabilities: AccountCapabilities | null;
  onOpenNote?: ((path: string) => void) | undefined;
  defaults: WorkbenchDefaults;
  onDraftChange: (dirty: boolean) => void;
  onAccountChanged?: (() => void) | undefined;
  navigationVersion?: number;
  active?: boolean;
  onSaveViewChange?: ((open: boolean) => void) | undefined;
}) {
  const { t } = useI18n();
  const [saveViewOpen,setSaveViewOpen]=useState(false);
  useEffect(() => { if (!saveStarted.current) savePreparation.current++; setSaveViewOpen(false); }, [navigationVersion]);
  const [saving,setSaving]=useState(false);
  const [cancelling,setCancelling]=useState(false);
  const saveController = useRef<AbortController | undefined>(undefined);
  function cancelSave() { if (saveController.current) { setCancelling(true); saveController.current.abort(); } }
  useEffect(() => { if (!isActive) cancelSave(); }, [isActive]);
  const saveInFlight = useRef(false);
  const saveStarted = useRef(false);
  const savePreparation = useRef(0);
  useEffect(()=>onSaveViewChange?.(saveViewOpen),[saveViewOpen,onSaveViewChange]);
  const session = useRef(new BulkSession());
  const profileInputRef = useRef<HTMLInputElement>(null);
  const [profileUrl, setProfileUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [writeFilter, setWriteFilter] = useState("all");
  const [revision, setRevision] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const selectionId = useId();
  const [rowPlans, setRowPlans] = useState<Readonly<Record<string, { preview: PreviewResult; manifest: NoteWriteManifest }>>>({});
  const [prepared, setPrepared] = useState<readonly BatchSaveEntry[]>([]);
  const [folderPath, setFolderPath] = useState(defaults.folderPath);
  const [mediaPolicy, setMediaPolicy] = useState<MediaPolicy>(defaults.mediaPolicy);
  const [templateId, setTemplateId] = useState<TemplateId>("default");
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<ReadonlyMap<PreviewResult, string>>(() => new Map());
  const [result, setResult] = useState<BatchSaveResult | null>(null);
  const [progress, setProgress] = useState<Readonly<Record<string, string>>>({});
  const [transfers, setTransfers] = useState<Readonly<Record<string, SaveTransferProgress>>>({});
  const [retryDownloadTotal, setRetryDownloadTotal] = useState<number>();
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const bulkSourceRevision = useRef(0);
  const bulkDraftRevision = useRef(0);
  useEffect(() => () => { saveController.current?.abort(); savePreparation.current++; session.current.reset(); }, []);
  const rows = session.current.rows();
  const nextCursor = session.current.cursor();
  const retryPage = nextCursor !== null && failedCursor === nextCursor;
  const usageReceipts = session.current.usageReceipts();
  const platforms = [...new Set(rows.map((item) => item.post.platform))].sort();
  const visibleRows = rows.filter((item) => {
    const textMatches = `${item.post.title ?? ""} ${postListSummary(item.post)} ${item.post.author.displayName}`.toLowerCase().includes(filter.toLowerCase());
    const platformMatches = platformFilter === "all" || item.post.platform === platformFilter;
    const date = item.post.publishedAt?.slice(0, 10) ?? "";
    const dateMatches = (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    const plan = rowPlans[contentKey(item.post)]?.manifest;
    const saved = Boolean(plan?.alreadySaved || plan?.action === "skip" || plan?.action === "update");
    const writeMatches = writeFilter === "all" || (writeFilter === "new" ? Boolean(plan) && !saved && plan?.action === "new" : plan?.action === writeFilter)
      || writeFilter === "saved" && saved || writeFilter === "media" && item.post.media.length > 0;
    return textMatches && platformMatches && dateMatches && writeMatches;
  });
  const active = visibleRows.find((item) => contentKey(item.post) === activeKey) ?? visibleRows[0];
  const activeKeyValue = active ? contentKey(active.post) : null;
  const activePlan = activeKeyValue ? rowPlans[activeKeyValue] : undefined;
  const activeManifest = activePlan?.manifest;
  const inlineSupplement = active !== undefined && inlineSupplementPlatforms.has(active.post.platform);
  const listingOnlyPreview = active !== undefined && listingOnlyPreviewPlatforms.has(active.post.platform);
  const loadingDetails = activeKeyValue !== null && session.current.hasPendingDetails(activeKeyValue);
  const activeDetailError = active ? detailErrors.get(active) : undefined;
  const previewError = activeDetailError ?? (activePlan?.preview !== active && !loadingDetails ? error : null);
  const previewLoading = (loadingDetails && !inlineSupplement && !listingOnlyPreview) || (!activeManifest && !previewError);
  const inlineLoading = inlineSupplement && !previewError && (loadingDetails || activePlan?.preview !== active);
  const inlineStatus = inlineSupplement && (inlineLoading ? <p className="agentlens-parse-status agentlens-preview-loading" role="status">
    <img src={previewSpinner} alt="" />{t("bulk.previewContentLoading")}
  </p> : previewError ? <p className="agentlens-inline-error" role="alert">{previewError}</p> : null);
  void revision;

  useEffect(() => onDraftChange(rows.length > 0 && (!result || result.failures.length > 0 || result.successes.some(saved => saved.write.ledger.completion === "partial"))), [rows.length, result, onDraftChange]);

  useEffect(() => {
    savePreparation.current++;
    saveController.current?.abort();
    bulkSourceRevision.current += 1;
    bulkDraftRevision.current += 1;
    session.current = new BulkSession();
    setPrepared([]);
    setResult(null);
    setSaveViewOpen(false);
    setSaving(false);
    setBusy(false);
    setLoadingMore(false);
    setError(null);
    setDetailErrors(new Map());
    setFailedCursor(null);
    setRevision(value => value + 1);
  }, [signedIn, service, capabilities?.accountId]);

  function globalOptions(): BulkWriteOptions {
    return { folderPath, mediaPolicy, templateId, saveAsCopy: true };
  }

  useEffect(() => {
    if (!service || rows.length === 0) {
      setRowPlans({});
      return undefined;
    }
    let cancelled = false;
    void Promise.all(rows.map(async (preview) => [
      contentKey(preview.post),
      { preview, manifest: await service.planPreview(preview, globalOptions()) }
    ] as const)).then(
      (entries) => { if (!cancelled) setRowPlans(Object.fromEntries(entries)); },
      (caught) => { if (!cancelled) setError(message(caught)); }
);
    return () => { cancelled = true; };
  }, [service, revision, folderPath, mediaPolicy, templateId]);

  async function loadFirst(event: SyntheticEvent) {
    event.preventDefault();
    if (!service || (signedIn && !profileUrl.trim())) return;
    const requestRevision = bulkSourceRevision.current + 1;
    bulkSourceRevision.current = requestRevision;
    bulkDraftRevision.current += 1;
    const requestedUrl = signedIn ? profileUrl.trim() : BULK_DEMO_LINK;
    const targetSession = new BulkSession();
    session.current = targetSession;
    setBusy(true);
    setError(null);
    setDetailErrors(new Map());
    setPrepared([]);
    setRowPlans({});
    setResult(null);
    setProgress({});
    setFailedCursor(null);
    setMobileDetailOpen(false);
    setRevision((value) => value + 1);
    try {
      await targetSession.load(null, (cursor) => service.fetchProfilePage(requestedUrl, cursor));
      if (requestRevision !== bulkSourceRevision.current || session.current !== targetSession) return;
      setFailedCursor(null);
      setRevision((value) => value + 1);
    } catch (caught) {
      if (requestRevision === bulkSourceRevision.current && session.current === targetSession) setError(message(caught));
    } finally {
      if (signedIn) onAccountChanged?.();
      if (requestRevision === bulkSourceRevision.current && session.current === targetSession) { setBusy(false); setLoadingMore(false); }
    }
  }

  async function loadMore() {
    if (!service || busy || !session.current.cursor()) return;
    const requestRevision = bulkSourceRevision.current;
    const requestedUrl = signedIn ? profileUrl.trim() : BULK_DEMO_LINK;
    const targetSession = session.current;
    const cursor = targetSession.cursor();
    setLoadingMore(true);
    setBusy(true);
    setError(null);
    try {
      await targetSession.load(cursor, (nextCursor) => service.fetchProfilePage(requestedUrl, nextCursor));
      if (requestRevision !== bulkSourceRevision.current || session.current !== targetSession) return;
      setFailedCursor(null);
      setRevision((value) => value + 1);
    } catch (caught) {
      if (requestRevision === bulkSourceRevision.current && session.current === targetSession) {
        setFailedCursor(cursor);
        setError(message(caught));
      }
    } finally {
      if (signedIn) onAccountChanged?.();
      if (requestRevision === bulkSourceRevision.current && session.current === targetSession) { setBusy(false); setLoadingMore(false); }
    }
  }

  async function fetchArticleDetails(preview: PreviewResult) {
    if (!service) return;
    const target = session.current;
    setError(null);
    setDetailErrors(current => {
      if (!current.has(preview)) return current;
      const next = new Map(current);
      next.delete(preview);
      return next;
    });
    try {
      await target.supplement(contentKey(preview.post), original => {
        if (!service.supplementContent) throw new Error("Post supplementation is unavailable. Please update the plugin.");
        return service.supplementContent(original);
      });
      if (target === session.current) setRevision(value => value + 1);
    } catch (caught) {
      if (target === session.current) {
        let reason = preview.historyRestore ? "This saved post is incomplete. No new details will be requested." : message(caught);
        if (caught instanceof AgentLensError) {
          if (caught.serverCode === "SUPPLEMENT_RETRY_EXHAUSTED") {
            reason = t("bulk.previewRetryExhausted");
          } else if (caught.serverCode !== "SUPPLEMENT_OUTCOME_UNKNOWN"
            && caught.execution?.failureClass !== "reconciliation_required"
            && (caught.serverCode === "SUPPLEMENT_RETRY_COOLDOWN" || caught.execution?.retryAfterSeconds !== undefined)) {
            const seconds = caught.execution?.retryAfterSeconds;
            reason = seconds ? t("bulk.previewRetryAfter", { seconds }) : t("bulk.previewRetryLater");
          }
        }
        const detailError = t("bulk.previewDetailsFailed", { title: postListTitle(preview.post), reason });
        setDetailErrors(current => new Map(current).set(preview, detailError));
      }
    }
  }

  async function reviewBatch() {
    if (saving) return;
    if (!service) return;
    const requestRevision = bulkDraftRevision.current;
    const targetSession = session.current;
    setBusy(true);
    setError(null);
    try {
      const nextPrepared: BatchSaveEntry[] = [];
      for (const selected of targetSession.selected()) {
        const { post } = selected;
        if (selected.historyRestore && post.needSupplement === true) {
          setError("This saved post is incomplete. No new details will be requested and nothing was saved.");
          return;
        }
        if (post.platform === "wechat_official_account" && post.needSupplement === undefined) {
          setError(t("bulk.saveRefreshRequired", { title: postListTitle(post) }));
          return;
        }
        if (post.needSupplement === true && mediaPolicy !== "link_only" && !post.supplementUrl) {
          setError(t("bulk.saveDetailsUnavailable", { title: postListTitle(post) }));
          return;
        }
        const preview = signedIn ? selected : { ...selected, demo: true };
        if (requestRevision !== bulkDraftRevision.current || session.current !== targetSession) return;
        nextPrepared.push({ preview, manifest: await service.planPreview(preview, globalOptions()), displayTitle: postListTitle(preview.post) });
        if (requestRevision !== bulkDraftRevision.current || session.current !== targetSession) return;
      }
      setRevision(value => value + 1);
      setPrepared(nextPrepared);
      setResult(null);
      setProgress({});
      setSaveViewOpen(true);
    } catch (caught) {
      if (requestRevision === bulkDraftRevision.current && session.current === targetSession) setError(message(caught));
    } finally {
      if (requestRevision === bulkDraftRevision.current && session.current === targetSession) setBusy(false);
    }
  }

  async function saveBatch(entries = prepared, previous: BatchSaveResult | null = null) {
    if (!service || entries.length === 0 || saving || saveInFlight.current) return;
    saveInFlight.current = true;
    const controller = new AbortController();
    const { signal } = controller;
    saveController.current = controller;
    const preparation = ++savePreparation.current;
    const requestRevision = bulkDraftRevision.current;
    const targetSession = session.current;
    const isCurrent = () => preparation === savePreparation.current
      && requestRevision === bulkDraftRevision.current && session.current === targetSession;
    const options = globalOptions();
    const needsDetails = ({ preview }: BatchSaveEntry) =>
      signedIn && preview.post.needSupplement === true && options.mediaPolicy !== "link_only";
    const updateProgress = (key: string, status: string) => {
      if (isCurrent()) setProgress(current => ({ ...current, [key]: status }));
    };
    const retryKeys = new Set(entries.map(({ manifest }) => manifest.contentKey));
    const saved: BatchSaveResult = {
      successes: previous?.successes.filter(item => !retryKeys.has(item.write.ledger.contentKey)) ?? [],
      failures: previous?.failures.filter(item => !retryKeys.has(contentKey(item.preview.post))) ?? []
    };
    setCancelling(false);
    setBusy(true);
    setSaving(true);
    setError(null);
    setTransfers({});
    setRetryDownloadTotal(0);
    setProgress(Object.fromEntries(entries.filter(needsDetails)
      .map(({ manifest }) => [manifest.contentKey, "waiting-for-details"])));
    if (previous) setResult({ successes: [...saved.successes], failures: [...saved.failures] });

    const recordFailure = (entry: BatchSaveEntry, caught: unknown) => {
      const error = signal.aborted ? "Save cancelled." : message(caught);
      saved.failures.push({ preview: entry.preview, error });
      updateProgress(entry.manifest.contentKey, "failed · " + error);
    };
    const writes: Promise<void>[] = [];
    const enqueue = (ready: readonly BatchSaveEntry[]) => {
      if (!ready.length) return;
      saveStarted.current = true;
      const count = ready.reduce((total, { manifest }) => total + plannedDownloadCount(manifest), 0);
      setRetryDownloadTotal(total => (total ?? 0) + count);
      const write = service.savePrepared(ready, updateProgress, {
        signal,
        onTransfer: transfer => {
          if (isCurrent()) setTransfers(current => ({ ...current, [transfer.contentKey]: transfer }));
        }
      }).then(result => {
        saved.successes.push(...result.successes);
        saved.failures.push(...result.failures);
      }).catch(caught => {
        for (const entry of ready) recordFailure(entry, caught);
      });
      writes.push(write);
    };

    try {
      // Existing plans can start immediately. Only works that need details wait for supplementation.
      const pending: BatchSaveEntry[] = [];
      const ready: BatchSaveEntry[] = [];
      for (const entry of entries) {
        if (previous || needsDetails(entry)) pending.push(entry);
        else ready.push(entry);
      }
      enqueue(ready);
      for (const entry of pending) {
        if (!isCurrent()) break;
        try {
          signal.throwIfAborted();
          let preview = entry.preview;
          if (needsDetails(entry)) {
            updateProgress(entry.manifest.contentKey, "loading-details");
            preview = await targetSession.supplement(contentKey(preview.post), original => {
              if (!service.supplementContent) throw new Error("Post supplementation is unavailable. Please update the plugin.");
              return service.supplementContent(original);
            });
            if (!isCurrent()) break;
            signal.throwIfAborted();
          }
          const manifest = await service.planPreview(preview, { ...options, targetNotePath: entry.manifest.notePath });
          if (!isCurrent()) break;
          signal.throwIfAborted();
          const updated = { ...entry, preview, manifest };
          setPrepared(current => current.map(item => item.manifest.contentKey === manifest.contentKey ? updated : item));
          updateProgress(manifest.contentKey, "");
          enqueue([updated]);
        } catch (caught) {
          if (!isCurrent()) break;
          recordFailure(entry, caught);
        }
      }

      await Promise.all(writes);
      if (!isCurrent()) return;
      setResult(saved);
      setRevision(value => value + 1);
      if (!signal.aborted && !signedIn && saved.successes.length > 0) (onDemoSaved ?? onRequestSignUp)?.();
    } finally {
      if (saveController.current === controller) { saveController.current = undefined; setCancelling(false); }
      saveInFlight.current = false;
      saveStarted.current = false;
      if (requestRevision === bulkDraftRevision.current && session.current === targetSession) {setBusy(false);setSaving(false);}
    }
  }

  function retryFailures() {
    if (!result) return;
    const failed = new Set(result.failures.map(item => contentKey(item.preview.post)));
    const partial = new Map(result.successes.filter(item => item.write.ledger.completion === "partial")
      .map(item => [item.write.ledger.contentKey, item.write.manifest]));
    const retry = prepared.flatMap(entry => {
      const key = entry.manifest.contentKey;
      const manifest = partial.get(key);
      if (manifest) return [{ ...entry, manifest }];
      return failed.has(key) ? [entry] : [];
    });
    void saveBatch(retry, result);
  }

  function mutateSelection(kind: "all" | "clear" | "new" | "media") {
    if (saving) return;
    bulkDraftRevision.current += 1;
    if (kind === "all") session.current.selectAll(visibleRows.map((preview) => contentKey(preview.post)));
    else if (kind === "clear") session.current.clearSelection();
    else if (kind === "new") session.current.selectOnly(rows.filter((preview) => rowPlans[contentKey(preview.post)]?.manifest.action === "new" && !rowPlans[contentKey(preview.post)]?.manifest.alreadySaved).map((preview) => contentKey(preview.post)));
    else session.current.selectOnly(rows.filter((preview) => preview.post.media.length > 0).map((preview) => contentKey(preview.post)));
    setPrepared([]);
    setResult(null);
    setBusy(loadingMore);
    setRevision((value) => value + 1);
  }

  function changeProfileUrl(nextUrl: string) {
    bulkSourceRevision.current += 1;
    bulkDraftRevision.current += 1;
    session.current = new BulkSession();
    setProfileUrl(nextUrl);
    setSaveViewOpen(false);
    setSaving(false);
    setActiveKey(null);
    setMobileDetailOpen(false);
    setRowPlans({});
    setPrepared([]);
    setResult(null);
    setProgress({});
    setFailedCursor(null);
    setError(null);
    setDetailErrors(new Map());
    setBusy(false);
    setLoadingMore(false);
    setRevision((value) => value + 1);
  }

  if (saveViewOpen && prepared.length) return <BatchSaveView entries={prepared} progress={progress} transfers={transfers} downloadTotal={retryDownloadTotal} result={result} saving={saving} error={error} onBack={()=>{if(!saveStarted.current){savePreparation.current++;saveController.current?.abort();}setSaveViewOpen(false);setMobileDetailOpen(false);}} onSave={()=>void saveBatch()} onRetry={retryFailures} onCancel={cancelSave} cancelling={cancelling} onOpenNote={onOpenNote} />;

  return (
    <div className={`agentlens-pane agentlens-bulk-pane${rows.length ? " has-results" : ""}`} style={{...mediaControlStyle, "--agentlens-checkbox-selected": `url("${bulkCheckboxSelected}")`} as CSSProperties}>
      <form className="agentlens-bulk-toolbar" onSubmit={(event) => void loadFirst(event)}>
            <div className="agentlens-url-bar">
            <label className="agentlens-sr-only" htmlFor="agentlens-profile-url">Creator profile URL</label>
            <input ref={profileInputRef} id="agentlens-profile-url" type="text" inputMode="url" required placeholder="Paste a creator profile URL…" value={signedIn ? profileUrl : BULK_DEMO_LINK} readOnly={!signedIn} onPaste={event => { if (!signedIn) { event.preventDefault(); onRequestSignUp?.(); } }} onKeyDown={event => { if (!signedIn && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); onRequestSignUp?.(); } }} onChange={(event) => changeProfileUrl(publicLinkFromText(event.currentTarget.value))} />
            {profileUrl && <button type="button" className="agentlens-clear-input" aria-label="Clear creator profile URL" onClick={() => { changeProfileUrl(""); profileInputRef.current?.focus(); }}>×</button>}
            <button type="submit" className="mod-cta" disabled={busy || !service || (signedIn && (!profileUrl.trim() || !operationAvailable(capabilities, "profile", service.clientVersion())))} aria-label="Fetch page" aria-busy={busy}>{busy ? "Parsing…" : signedIn ? "Parse" : "Try this link"}</button>
            </div>
          {busy && !saving && !loadingMore && <p className="agentlens-parse-status" role="status">{rows.length ? "Loading or preparing posts…" : "Fetching posts…"} This can take a moment.</p>}
          {error && <p className="agentlens-inline-error" data-pinterest-guidance={isPinterestGuidance(error) || undefined} role="alert">{error}</p>}
      </form>
      {rows.length > 0 ? (
            <div className={"agentlens-master-detail agentlens-bulk-results"}>
              <section className="agentlens-result-list" aria-label="Creator posts">
                <div className="agentlens-bulk-selection-bar">
                  <label><input type="checkbox" aria-label="Select visible" disabled={saving || visibleRows.length === 0} checked={visibleRows.length > 0 && visibleRows.every(item => session.current.isSelected(contentKey(item.post)))} onChange={() => {const all=visibleRows.every(item=>session.current.isSelected(contentKey(item.post))); bulkDraftRevision.current += 1; for(const item of visibleRows) {const key=contentKey(item.post);if(session.current.isSelected(key)===all)session.current.toggle(key);}setPrepared([]);setRevision(current=>current+1);}} />Select All {session.current.selected().length > 0 && <span>{session.current.selected().length}</span>}</label>
                  <nav aria-label="Post status filters">{[['all','All'],['new','New'],['saved','Already saved'],['media','Has media']].map(([value,label])=><button key={value} type="button" aria-pressed={writeFilter===value} onClick={()=>setWriteFilter(value!)}>{label}</button>)}</nav>
                </div>
                <details className="agentlens-bulk-advanced"><summary>More filters</summary>
                <p className="agentlens-usage-receipt" role="status">{rows.some(row => row.historyRestore) ? "Original request receipt: " : ""}{usageReceipts.length} page(s) fetched · {usageReceipts.reduce((total, receipt) => total + (receipt.charged ? receipt.units : 0), 0)} credit(s) charged{usageReceipts.at(-1)?.remaining !== null && usageReceipts.at(-1)?.remaining !== undefined ? ` · ${usageReceipts.at(-1)?.remaining} remaining` : ""}</p>
                <div className="agentlens-bulk-filters" aria-label="Loaded post filters">
                  <input type="search" aria-label="Filter loaded posts" placeholder="Filter loaded posts" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />
                  <label>Platform<select aria-label="Filter by platform" value={platformFilter} onChange={(event) => setPlatformFilter(event.currentTarget.value)}><option value="all">All platforms</option>{platforms.map((platform) => <option value={platform} key={platform}>{platform}</option>)}</select></label>
                  <label>From<input aria-label="Published from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.currentTarget.value)} /></label>
                  <label>To<input aria-label="Published to" type="date" value={dateTo} onChange={(event) => setDateTo(event.currentTarget.value)} /></label>
                  <label>Write status<select aria-label="Filter by write status" value={writeFilter} onChange={(event) => setWriteFilter(event.currentTarget.value)}><option value="all">All states</option><option value="new">New note</option><option value="update">Update</option><option value="skip">Skip</option><option value="blocked">Blocked</option></select></label>
                </div>
                <div className="agentlens-advanced-selection" aria-label="Selection actions">
                  <button type="button" onClick={() => mutateSelection("all")}>Select visible</button>
                  <button type="button" onClick={() => mutateSelection("clear")}>Clear</button>
                  <button type="button" onClick={() => mutateSelection("new")}>Only new notes</button>
                  <button type="button" onClick={() => mutateSelection("media")}>Only with media</button>
                </div>
                </details>
                <div className="agentlens-single-controls agentlens-bulk-controls">
                  <label>Template<select aria-label="Note template" disabled={saving} value={templateId} onChange={event=>{bulkDraftRevision.current+=1;setBusy(loadingMore);setTemplateId(event.currentTarget.value as TemplateId);setPrepared([]);setResult(null);}}><option value="default">Default template</option></select></label>
                  <fieldset><legend className="agentlens-sr-only">Media files</legend><span aria-hidden="true">Media files</span>{(['download_all','link_only',...(mediaPolicy==='download_images_only'?['download_images_only']:[])] as MediaPolicy[]).map(policy=><label className={mediaPolicy===policy?'is-selected':''} key={policy}><input type="radio" name="bulk-media-policy" disabled={saving} value={policy} checked={mediaPolicy===policy} onChange={()=>{bulkDraftRevision.current+=1;setBusy(loadingMore);setMediaPolicy(policy);setPrepared([]);setResult(null);}} />{policy==='download_all'?'Download available':policy==='link_only'?'Link only':'Images only'}</label>)}</fieldset>
                </div>
                <div className="agentlens-bulk-posts">
                {visibleRows.length === 0 && <div className="agentlens-bulk-filter-empty">
                  <p role="status">{t("bulk.noFilterMatches")}</p>
                  <button type="button" onClick={() => { setFilter(""); setPlatformFilter("all"); setDateFrom(""); setDateTo(""); setWriteFilter("all"); }}>{t("bulk.clearFilters")}</button>
                </div>}
                {rows.some(item => item.post.platform === "wechat_official_account") && <p className="setting-item-description">Open a post preview to complete its available details at no additional credit cost.</p>}
                {visibleRows.map((preview, index) => {
                  const key = contentKey(preview.post);
                  const checkboxId = `${selectionId}-${index}`;
                  const counts = mediaCounts(preview.post);
                  return (
                    <div key={key} className={`agentlens-bulk-post${session.current.isSelected(key) ? " is-selected" : ""}`}>
                      {!saving && <label className="agentlens-bulk-post-hit-area" htmlFor={checkboxId} aria-hidden="true" />}
                      <input
                        id={checkboxId}
                        type="checkbox"
                        aria-label={`Select ${postListTitle(preview.post)}`}
                        disabled={saving}
                        checked={session.current.isSelected(key)}
                        onChange={() => {
                          bulkDraftRevision.current += 1;
                          session.current.toggle(key);

                          setPrepared([]);
                          setResult(null);
                          setBusy(loadingMore);
                          setRevision((value) => value + 1);
                        }}
                      />
                      <RemoteThumbnail url={postThumbnailUrl(preview.post)} kind={preview.post.media[0]?.kind ?? "Text only"} />
                      <div className="agentlens-bulk-post-copy"><strong>{postListTitle(preview.post)}</strong><p>{postListSummary(preview.post)}</p><div><time dateTime={preview.post.publishedAt}>{preview.post.publishedAt ? relativePublished(preview.post.publishedAt) : 'Date unavailable'}</time><span><img src={bulkAssets.imgImage} alt="Images" />{counts.images}</span><span><img src={bulkAssets.imgVideo} alt="Videos" />{counts.videos}</span>{counts.audio>0 && <span>{counts.audio} audio</span>}</div></div>
                      <button type="button" aria-label={`Preview ${postListTitle(preview.post)}`} onClick={() => {setActiveKey(key);setMobileDetailOpen(true);if (preview.post.needSupplement === true && !listingOnlyPreviewPlatforms.has(preview.post.platform)) void fetchArticleDetails(preview);}}>Preview</button>
                    </div>
);
                })}
                </div>
                {nextCursor && !rows.some(row => row.historyRestore) && <div className="agentlens-fetch-more"><button type="button" onClick={() => void loadMore()} disabled={busy} aria-label={retryPage ? "Retry failed page" : (signedIn ? "Fetch more · estimated 1 credit" : "Fetch more")}>{loadingMore ? "Fetching More…" : retryPage ? "Retry failed page" : "Fetch more"}</button></div>}
                <footer className="agentlens-single-footer agentlens-bulk-footer"><FolderField compact label="Destination folder" value={folderPath} onChange={path=>{if(saving)return;bulkDraftRevision.current+=1;setBusy(loadingMore);setFolderPath(path);setPrepared([]);setResult(null);}} /><button type="button" disabled={(busy && !saving) || cancelling} onClick={()=>{if(saving)cancelSave();else changeProfileUrl('');}}>Cancel</button><button type="button" className="mod-cta" aria-label="Review batch manifest" onClick={()=>{if(prepared.length)setSaveViewOpen(true);else void reviewBatch();}} disabled={!saving && (busy || session.current.selected().length===0)}>{saving ? "View progress" : result ? "View results" : "Save"}</button></footer>
              </section>
              {mobileDetailOpen && active && <WorkbenchDialog title="Preview" className="agentlens-post-preview-dialog" placement="right" closeIcon={previewClose} closeOnBackdrop onClose={()=>setMobileDetailOpen(false)}>
                <section aria-label="Selected post detail" className="agentlens-post-preview-content">
                  {previewLoading ? <p className="agentlens-parse-status agentlens-preview-loading" role="status">
                    <img src={previewSpinner} alt="" />{t("bulk.previewLoading")}
                  </p> : <>
                    {previewError && (!inlineSupplement || !activeManifest) && <p className="agentlens-inline-error" role="alert">{previewError}</p>}
                    {activeManifest && <PostPreviewDocument post={active.post} manifest={activeManifest}
                      contentStatus={inlineStatus} videoCover={listingOnlyPreview ? postThumbnailUrl(active.post) : undefined} />}
                  </>}
                </section>
              </WorkbenchDialog>}
            </div>
) : signedIn ? (
        <section className="agentlens-preview-card is-empty"><EmptyStateIllustration /><h3>Paste a link to begin</h3><p>AgentLens parses the source first. Nothing is written<br />to your Vault until you confirm the save settings.</p></section>
) : <WorkflowOnboarding variant="bulk" onRequestSignUp={onStartFree ?? onRequestSignUp} />}
      <BackToTop />
    </div>
);
}

function relativePublished(value: string): string {
  const elapsed = Math.max(0,Date.now()-Date.parse(value));
  if (!Number.isFinite(elapsed)) return value;
  if (elapsed < 60000) return 'Just now';
  const units = elapsed<3600000 ? [60000,'minute'] as const : elapsed<86400000 ? [3600000,'hour'] as const : [86400000,'day'] as const;
  const count = Math.floor(elapsed/units[0]); return `${count} ${units[1]}${count===1?'':'s'} ago`;
}
