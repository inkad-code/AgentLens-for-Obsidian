import type { SyntheticEvent } from "react";
import { NoteProperties } from "./NoteProperties";
import { renderNotePreview } from "../../vault/VaultWriter";
import type { CSSProperties } from "react";
import { mediaControlStyle } from "./singleControlAssets";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { BatchSaveView } from "./BatchSaveView";
import { bulkAssets, bulkCheckboxSelected } from "./bulkAssets";
import { FolderField } from "./FolderField";
import { MarkdownPreview } from "./MarkdownPreview";
import { useEffect, useRef, useState } from "react";
import type { NoteWriteManifest } from "../../vault/VaultWriter";
import type { BatchSaveResult, PreviewResult } from "../../workbench/types";
import type { BulkWorkbenchPort } from "../../workbench/ports";
import { BulkSession } from "../../bulk/BulkSession";
import { postListTitle, postThumbnailUrl, contentKey } from "../../core/domain";
import type { MediaPolicy } from "../../core/domain";
import type { AccountCapabilities } from "../../api/contracts";
import { publicLinkFromText } from "../../core/urls";
import type { TemplateId, WorkbenchDefaults } from "./types";
import { RemoteThumbnail, mediaCounts, message, operationAvailable } from "./shared";
import { BackToTop } from "./BackToTop";
import { WorkflowOnboarding } from "./WorkflowOnboarding";
import { BULK_DEMO_LINK } from "./demoLinks";
import { demoBlockIcon } from "./demoAssets";

type BulkWriteOptions = { folderPath: string; mediaPolicy: MediaPolicy; templateId: TemplateId; saveAsCopy: true };

export function BulkFetchPane({
  onRequestSignUp,
  service,
  signedIn,
  capabilities,
  onOpenNote,
  defaults,
  onDraftChange,
  onAccountChanged,
  onSaveViewChange,
  navigationVersion = 0
}: {
  service?: BulkWorkbenchPort | undefined;
  signedIn: boolean;
  onRequestSignUp?: (()=>void) | undefined;
  capabilities: AccountCapabilities | null;
  onOpenNote?: ((path: string) => void) | undefined;
  defaults: WorkbenchDefaults;
  onDraftChange: (dirty: boolean) => void;
  onAccountChanged?: (() => void) | undefined;
  navigationVersion?: number;
  onSaveViewChange?: ((open: boolean) => void) | undefined;
}) {
  const [saveViewOpen,setSaveViewOpen]=useState(false);
  useEffect(() => { setSaveViewOpen(false); }, [navigationVersion]);
  const [saving,setSaving]=useState(false);
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
  const [rowPlans, setRowPlans] = useState<Readonly<Record<string, NoteWriteManifest>>>({});
  const [prepared, setPrepared] = useState<ReadonlyArray<{ preview: PreviewResult; manifest: NoteWriteManifest }>>([]);
  const [folderPath, setFolderPath] = useState(defaults.folderPath);
  const [mediaPolicy, setMediaPolicy] = useState<MediaPolicy>(defaults.mediaPolicy);
  const [templateId, setTemplateId] = useState<TemplateId>("default");
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchSaveResult | null>(null);
  const [progress, setProgress] = useState<Readonly<Record<string, string>>>({});
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const bulkSourceRevision = useRef(0);
  const bulkDraftRevision = useRef(0);
  const rows = session.current.rows();
  const usageReceipts = session.current.usageReceipts();
  const platforms = [...new Set(rows.map((item) => item.post.platform))].sort();
  const visibleRows = rows.filter((item) => {
    const textMatches = `${item.post.title ?? ""} ${item.post.text} ${item.post.author.displayName}`.toLowerCase().includes(filter.toLowerCase());
    const platformMatches = platformFilter === "all" || item.post.platform === platformFilter;
    const date = item.post.publishedAt?.slice(0, 10) ?? "";
    const dateMatches = (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    const plan = rowPlans[contentKey(item.post)];
    const saved = Boolean(plan?.alreadySaved || plan?.action === "skip" || plan?.action === "update");
    const writeMatches = writeFilter === "all" || (writeFilter === "new" ? Boolean(plan) && !saved && plan?.action === "new" : plan?.action === writeFilter)
      || writeFilter === "saved" && saved || writeFilter === "media" && item.post.media.length > 0;
    return textMatches && platformMatches && dateMatches && writeMatches;
  });
  const active = visibleRows.find((item) => contentKey(item.post) === activeKey) ?? visibleRows[0];
  const activeKeyValue = active ? contentKey(active.post) : null;
  const activeManifest = activeKeyValue ? rowPlans[activeKeyValue] : undefined;
  void revision;

  useEffect(() => onDraftChange(rows.length > 0 && (!result || result.failures.length > 0 || result.successes.some(saved => saved.write.ledger.completion === "partial"))), [rows.length, result, onDraftChange]);

  useEffect(() => {
    bulkSourceRevision.current += 1;
    bulkDraftRevision.current += 1;
    session.current = new BulkSession();
    setPrepared([]);
    setResult(null);
    setSaveViewOpen(false);
    setBusy(false);
    setLoadingMore(false);
    setError(null);
    setFailedCursor(null);
    setRevision(value => value + 1);
  }, [signedIn]);

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
      await service.planPreview(preview, globalOptions())
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

  async function fetchArticleDetails(key: string) {
    if (!service) return;
    const target = session.current;
    try {
      await target.hydrate(key, url => service.previewSingle(url));
      if (target === session.current) setRevision(value => value + 1);
    } catch (caught) {
      if (target === session.current) setError(message(caught));
    } finally { onAccountChanged?.(); }
  }

  async function reviewBatch() {
    if (saving) return;
    if (!service) return;
    const requestRevision = bulkDraftRevision.current;
    const targetSession = session.current;
    setBusy(true);
    setError(null);
    try {
      const nextPrepared: Array<{ preview: PreviewResult; manifest: NoteWriteManifest }> = [];
      for (const selected of targetSession.selected()) {
        const hydrated = await targetSession.hydrate(contentKey(selected.post), url => service.previewSingle(url));
        const preview = signedIn ? hydrated : { ...hydrated, demo: true };
        if (requestRevision !== bulkDraftRevision.current || session.current !== targetSession) return;
        nextPrepared.push({ preview, manifest: await service.planPreview(preview, globalOptions()) });
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

  async function saveBatch() {
    if (!service || prepared.length === 0) return;
    const requestRevision = bulkDraftRevision.current;
    const targetSession = session.current;
    setBusy(true);
    setSaving(true);
    setError(null);
    setProgress(Object.fromEntries(prepared.map(({ manifest }) => [manifest.contentKey, `Queued · 1 note · ${manifest.attachments.length} attachment(s)`])));
    try {
      const saved = await service.savePrepared(prepared, (contentKeyValue, status) => {
        if (requestRevision === bulkDraftRevision.current && session.current === targetSession) {
          setProgress((current) => ({ ...current, [contentKeyValue]: status }));
        }
      });
      if (requestRevision !== bulkDraftRevision.current || session.current !== targetSession) return;
      setResult(saved);
      setRevision(value => value + 1);
      if (!signedIn && saved.successes.length > 0) onRequestSignUp?.();
    } catch (caught) {
      if (requestRevision === bulkDraftRevision.current && session.current === targetSession) setError(message(caught));
    } finally {
      if (requestRevision === bulkDraftRevision.current && session.current === targetSession) {setBusy(false);setSaving(false);}
    }
  }

  async function retryFailures() {
    if (!service || !result) return;
    const requestRevision = bulkDraftRevision.current;
    const targetSession = session.current;
    const partialKeys = new Set(result.successes
      .filter((saved) => saved.write.ledger.completion === "partial")
      .map((saved) => saved.write.ledger.contentKey));
    const retryByKey = new Map<string, { preview: PreviewResult; manifest: NoteWriteManifest }>();
    for (const failure of result.failures) {
      const entry = prepared.find(({ preview }) => contentKey(preview.post) === contentKey(failure.preview.post));
      if (entry) retryByKey.set(entry.manifest.contentKey, entry);
    }
    for (const entry of prepared) {
      if (partialKeys.has(entry.manifest.contentKey)) retryByKey.set(entry.manifest.contentKey, entry);
    }
    if (retryByKey.size === 0) return;
    setBusy(true);
    setSaving(true);
    setError(null);
    try {
      const retryPrepared = await Promise.all([...retryByKey.values()].map(async ({ preview }) => ({
        preview,
        manifest: await service.planPreview(preview, { ...globalOptions(), targetNotePath: retryByKey.get(contentKey(preview.post))?.manifest.notePath })
      })));
      if (requestRevision !== bulkDraftRevision.current || session.current !== targetSession) return;
      const retried = await service.savePrepared(retryPrepared, (contentKeyValue, status) => {
        if (requestRevision === bulkDraftRevision.current && session.current === targetSession) {
          setProgress((current) => ({ ...current, [contentKeyValue]: status }));
        }
      });
      if (requestRevision !== bulkDraftRevision.current || session.current !== targetSession) return;
      const retriedKeys = new Set(retryPrepared.map(({ manifest }) => manifest.contentKey));
      setResult({
        successes: [
          ...result.successes.filter((saved) => !retriedKeys.has(saved.write.ledger.contentKey)),
          ...retried.successes
        ],
        failures: retried.failures
      });
      if (!signedIn && retried.successes.length > 0) onRequestSignUp?.();
    } catch (caught) {
      if (requestRevision === bulkDraftRevision.current && session.current === targetSession) setError(message(caught));
    } finally {
      if (requestRevision === bulkDraftRevision.current && session.current === targetSession) {setBusy(false);setSaving(false);}
    }
  }

  function mutateSelection(kind: "all" | "clear" | "new" | "media") {
    if (saving) return;
    bulkDraftRevision.current += 1;
    if (kind === "all") session.current.selectAll(visibleRows.map((preview) => contentKey(preview.post)));
    else if (kind === "clear") session.current.clearSelection();
    else if (kind === "new") session.current.selectOnly(rows.filter((preview) => rowPlans[contentKey(preview.post)]?.action === "new" && !rowPlans[contentKey(preview.post)]?.alreadySaved).map((preview) => contentKey(preview.post)));
    else session.current.selectOnly(rows.filter((preview) => preview.post.media.length > 0).map((preview) => contentKey(preview.post)));
    for (const preview of session.current.selected()) {
      if (preview.post.platform === "wechat_official_account") void fetchArticleDetails(contentKey(preview.post));
    }
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
    setBusy(false);
    setLoadingMore(false);
    setRevision((value) => value + 1);
  }

  if (saveViewOpen && prepared.length) return <BatchSaveView entries={prepared} progress={progress} result={result} saving={saving} error={error} onBack={()=>{setSaveViewOpen(false);setMobileDetailOpen(false);}} onSave={()=>void saveBatch()} onRetry={()=>void retryFailures()} onOpenNote={onOpenNote} />;

  return (
    <div className={`agentlens-pane agentlens-bulk-pane${rows.length ? " has-results" : ""}`} style={{...mediaControlStyle, "--agentlens-checkbox-selected": `url("${bulkCheckboxSelected}")`} as CSSProperties}>
      <form className="agentlens-bulk-toolbar" onSubmit={(event) => void loadFirst(event)}>
            <div className="agentlens-url-bar">
            <label className="agentlens-sr-only" htmlFor="agentlens-profile-url">Creator profile URL</label>
            <input ref={profileInputRef} id="agentlens-profile-url" type="text" inputMode="url" required placeholder="Paste a creator profile URL…" value={signedIn ? profileUrl : BULK_DEMO_LINK} readOnly={!signedIn} aria-describedby={signedIn ? undefined : "agentlens-bulk-demo-help"} onPaste={event => { if (!signedIn) { event.preventDefault(); onRequestSignUp?.(); } }} onKeyDown={event => { if (!signedIn && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); onRequestSignUp?.(); } }} onChange={(event) => changeProfileUrl(publicLinkFromText(event.currentTarget.value))} />
            {profileUrl && <button type="button" className="agentlens-clear-input" aria-label="Clear creator profile URL" onClick={() => { changeProfileUrl(""); profileInputRef.current?.focus(); }}>×</button>}
            <button type="submit" className="mod-cta" disabled={busy || !service || (signedIn && !operationAvailable(capabilities, "profile", service.clientVersion()))} aria-label="Fetch page" aria-busy={busy}>{busy ? "Parsing…" : signedIn ? "Parse" : "Try this link"}</button>
            </div>
          {!signedIn && <p id="agentlens-bulk-demo-help" className="setting-item-description agentlens-demo-help">
            <img src={demoBlockIcon} alt="" /><span>try this link for a demo preview, or <button type="button" className="agentlens-inline-signup" onClick={onRequestSignUp}>sign up</button> to start free with real links.</span>
          </p>}

          {busy && !saving && !loadingMore && <p className="agentlens-parse-status" role="status">{rows.length ? "Loading or preparing posts…" : "Fetching posts…"} This can take a moment.</p>}
          {error && <p className="agentlens-inline-error" role="alert">{error}</p>}
      </form>
      {rows.length > 0 ? (
            <div className={"agentlens-master-detail agentlens-bulk-results"}>
              <section className="agentlens-result-list" aria-label="Creator posts">
                <div className="agentlens-bulk-selection-bar">
                  <label><input type="checkbox" aria-label="Select visible" disabled={saving} checked={visibleRows.length > 0 && visibleRows.every(item => session.current.isSelected(contentKey(item.post)))} onChange={() => {const all=visibleRows.every(item=>session.current.isSelected(contentKey(item.post))); bulkDraftRevision.current += 1; for(const item of visibleRows) {const key=contentKey(item.post);if(session.current.isSelected(key)===all)session.current.toggle(key);if(!all && item.post.platform === "wechat_official_account") void fetchArticleDetails(key);}setPrepared([]);setRevision(current=>current+1);}} />Select All {session.current.selected().length > 0 && <span>{session.current.selected().length}</span>}</label>
                  <nav aria-label="Post status filters">{[['all','All'],['new','New'],['saved','Already saved'],['media','Has media']].map(([value,label])=><button key={value} type="button" aria-pressed={writeFilter===value} onClick={()=>setWriteFilter(value!)}>{label}</button>)}</nav>
                </div>
                <details className="agentlens-bulk-advanced"><summary>More filters</summary>
                <p className="agentlens-usage-receipt" role="status">{usageReceipts.length} page(s) fetched · {usageReceipts.reduce((total, receipt) => total + (receipt.charged ? receipt.units : 0), 0)} credit(s) charged{usageReceipts.at(-1)?.remaining !== null && usageReceipts.at(-1)?.remaining !== undefined ? ` · ${usageReceipts.at(-1)?.remaining} remaining` : ""}</p>
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
                {rows.some(item => item.post.platform === "wechat_official_account") && <p className="setting-item-description">Selected articles are fetched in full before saving and may use additional credits.</p>}
                {visibleRows.map((preview) => {
                  const key = contentKey(preview.post);
                  const counts = mediaCounts(preview.post);
                  return (
                    <div key={key} className={`agentlens-bulk-post${session.current.isSelected(key) ? " is-selected" : ""}`}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${postListTitle(preview.post)}`}
                        disabled={saving}
                        checked={session.current.isSelected(key)}
                        onChange={() => {
                          bulkDraftRevision.current += 1;
                          session.current.toggle(key);
                          if (session.current.isSelected(key) && preview.post.platform === "wechat_official_account") void fetchArticleDetails(key);
                          setPrepared([]);
                          setResult(null);
                          setBusy(loadingMore);
                          setRevision((value) => value + 1);
                        }}
                      />
                      <RemoteThumbnail url={postThumbnailUrl(preview.post)} kind={preview.post.media[0]?.kind ?? "Text only"} />
                      <div className="agentlens-bulk-post-copy"><strong>{postListTitle(preview.post)}</strong><p>{preview.post.text}</p><div><time dateTime={preview.post.publishedAt}>{preview.post.publishedAt ? relativePublished(preview.post.publishedAt) : 'Date unavailable'}</time><span><img src={bulkAssets.imgImage} alt="Images" />{counts.images}</span><span><img src={bulkAssets.imgVideo} alt="Videos" />{counts.videos}</span>{counts.audio>0 && <span>{counts.audio} audio</span>}</div></div>
                      <button type="button" aria-label={`Preview ${postListTitle(preview.post)}`} onClick={() => {setActiveKey(key);setMobileDetailOpen(true);if(preview.post.platform === "wechat_official_account") void fetchArticleDetails(key);}}>Preview</button>
                    </div>
);
                })}
                </div>
                <div className="agentlens-fetch-more"><button type="button" onClick={() => void loadMore()} disabled={busy || !session.current.cursor()} aria-label={failedCursor === session.current.cursor() && failedCursor ? "Retry failed page" : (signedIn ? "Fetch more · estimated 1 credit" : "Fetch more")}>{loadingMore ? "Fetching More…" : failedCursor === session.current.cursor() && failedCursor ? "Retry failed page" : "Fetch more"}</button></div>
                <footer className="agentlens-single-footer agentlens-bulk-footer"><FolderField compact label="Destination folder" value={folderPath} onChange={path=>{if(saving)return;bulkDraftRevision.current+=1;setBusy(loadingMore);setFolderPath(path);setPrepared([]);setResult(null);}} /><button type="button" disabled={busy} onClick={()=>changeProfileUrl('')}>Cancel</button><button type="button" className="mod-cta" aria-label="Review batch manifest" onClick={()=>{if(prepared.length)setSaveViewOpen(true);else void reviewBatch();}} disabled={!saving && (busy || session.current.selected().length===0)}>{saving ? "View progress" : result ? "View results" : "Save"}</button></footer>
              </section>
              {mobileDetailOpen && active && activeManifest && <WorkbenchDialog title="Preview" className="agentlens-post-preview-dialog" placement="right" closeOnBackdrop onClose={()=>setMobileDetailOpen(false)}>
                <section aria-label="Selected post detail" className="agentlens-post-preview-content">
                  <div className="agentlens-post-preview-document"><NoteProperties frontmatter={activeManifest.frontmatter} /><MarkdownPreview markdown={renderNotePreview(active.post, activeManifest)} sourcePath={activeManifest.notePath} /></div>

                </section>
              </WorkbenchDialog>}
            </div>
) : signedIn ? (
        <section className="agentlens-preview-card is-empty"><div className="agentlens-empty-proof" aria-hidden="true" /><h3>Paste a link to begin</h3><p>AgentLens parses the source first. Nothing is written<br />to your Vault until you confirm the save settings.</p></section>
) : <WorkflowOnboarding variant="bulk" onRequestSignUp={onRequestSignUp} />}
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
