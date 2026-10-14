import type { SyntheticEvent } from "react";
import { saveProgressLabel } from "./savePresentation";
import { BatchSaveView } from "./BatchSaveView";
import { NoteProperties } from "./NoteProperties";
import { renderNotePreview } from "../../vault/VaultWriter";
import { AgentLensError } from "../../core/errors";
import { mediaControlStyle } from "./singleControlAssets";
import { demoBlockIcon } from "./demoAssets";
import { FolderField } from "./FolderField";
import { useEffect, useRef, useState } from "react";
import type { NoteWriteManifest } from "../../vault/VaultWriter";
import type { BatchSaveResult, PreviewResult, SaveResult } from "../../workbench/types";
import type { SingleWorkbenchPort } from "../../workbench/ports";
import { DEMO_URL } from "../../workbench/AgentLensWorkbenchService";
import { SINGLE_DEMO_LINK } from "./demoLinks";
import { publicLinkFromText } from "../../core/urls";
import { postContentTags, postDisplayTitle, type MediaPolicy } from "../../core/domain";
import type { AccountCapabilities } from "../../api/contracts";
import type { TemplateId, WorkbenchDefaults } from "./types";
import { MarkdownPreview } from "./MarkdownPreview";
import { PlatformIcon, RemoteThumbnail, message, operationAvailable } from "./shared";
import { WorkflowOnboarding } from "./WorkflowOnboarding";

export function SingleFetchPane({
  onRequestSignUp,
  initialUrl,
  service,
  signedIn,
  capabilities,
  onOpenNote,
  defaults,
  onDraftChange,
  onAccountChanged,
  onSaveViewChange
}: {
  initialUrl?: string | undefined;
  service?: SingleWorkbenchPort | undefined;
  signedIn: boolean;
  onRequestSignUp?: (()=>void) | undefined;
  capabilities: AccountCapabilities | null;
  onOpenNote?: ((path: string) => void) | undefined;
  defaults: WorkbenchDefaults;
  onDraftChange: (dirty: boolean) => void;
  onAccountChanged?: (() => void) | undefined;
  onSaveViewChange?: ((open: boolean) => void) | undefined;
}) {
  const [url, setUrl] = useState(signedIn ? initialUrl ?? "" : DEMO_URL);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [manifest, setManifest] = useState<NoteWriteManifest | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [folderPath, setFolderPath] = useState(defaults.folderPath);
  const [mediaPolicy, setMediaPolicy] = useState<MediaPolicy>(defaults.mediaPolicy);
  const [templateId, setTemplateId] = useState<TemplateId>("default");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<BatchSaveResult | null>(null);
  useEffect(() => onSaveViewChange?.(saveViewOpen), [saveViewOpen, onSaveViewChange]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchFailure, setFetchFailure] = useState<AgentLensError | null>(null);
  const [clock, setClock] = useState(Date.now);
  const retryDeadline = fetchFailure?.execution?.retryAt ? Date.parse(fetchFailure.execution.retryAt) : 0;
  const retryBlocked = fetchFailure?.execution?.failureClass === "reconciliation_required" || retryDeadline > clock;
  useEffect(() => {
    if (retryDeadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryDeadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryDeadline]);
  const [saveProgress, setSaveProgress] = useState<string | null>(null);
  const sourceRevision = useRef(0);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const shownPreview = useRef<PreviewResult | null>(null);
  useEffect(() => {
    if (preview && manifest && shownPreview.current !== preview) {
      shownPreview.current = preview;
      summaryRef.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
    }
  }, [preview, manifest]);
  const writeRevision = useRef(0);
  const targetUrl = publicLinkFromText(url);

  useEffect(() => onDraftChange(Boolean(preview && !saved)), [preview, saved, onDraftChange]);

  useEffect(() => {
    sourceRevision.current += 1;
    writeRevision.current += 1;
    setUrl(signedIn ? initialUrl ?? "" : DEMO_URL);
    setFetchFailure(null);
    setSaveViewOpen(false);
    setSaving(false);
    setSaveResult(null);
    setPreview(null);
    setManifest(null);
    setSaved(null);
  }, [signedIn, initialUrl]);

  useEffect(() => {
    if (!service || !preview) return undefined;
    let cancelled = false;
    void service.planPreview(preview, { folderPath, mediaPolicy, templateId, saveAsCopy: true }).then(
      (next) => {
        if (cancelled) return;
        setManifest(next);
        setSaved(null);
      },
      (caught) => { if (!cancelled) setError(message(caught)); }
);
    return () => { cancelled = true; };
  }, [service, preview, folderPath, mediaPolicy, templateId]);

  async function fetchPreview(event: SyntheticEvent) {
    event.preventDefault();
    if (!service || retryBlocked) return;
    const revision = sourceRevision.current;
    writeRevision.current += 1;
    const requestedUrl = publicLinkFromText(url);
    setBusy(true);
    setError(null);
    setFetchFailure(null);
    setSaved(null);
    try {
      const nextPreview = await service.previewSingle(requestedUrl);
      if (revision !== sourceRevision.current) return;
      setPreview(nextPreview);
      setManifest(null);
    } catch (caught) {
      if (revision === sourceRevision.current) {
        setError(message(caught));
        setClock(Date.now());
        setFetchFailure(caught instanceof AgentLensError ? caught : null);
      }
    } finally {
      if (signedIn) onAccountChanged?.();
      if (revision === sourceRevision.current) setBusy(false);
    }
  }

  async function saveManifest(nextManifest: NoteWriteManifest) {
    if (!service || !preview) return;
    const revision = writeRevision.current;
    setBusy(true);
    setError(null);
    setSaving(true);
    setSaveResult(null);
    setSaveProgress(`Queued · 1 note · ${nextManifest.attachments.length} attachment(s)`);
    try {
      const result = await service.savePrepared([{ preview, manifest: nextManifest }], (_contentKey, status) => {
        if (revision === writeRevision.current) setSaveProgress(status);
      });
      if (revision !== writeRevision.current) return;
      setSaveResult(result);
      const failure = result.failures[0];
      if (failure) throw new Error(failure.error);
      const success = result.successes[0];
      if (!success) throw new Error("Vault write did not return a result.");
      setSaved(success);
      setManifest(success.write.manifest);
      if (!signedIn) onRequestSignUp?.();
    } catch (caught) {
      if (revision === writeRevision.current) setError(message(caught));
    } finally {
      if (revision === writeRevision.current) { setBusy(false); setSaving(false); }
    }
  }

  function savePreview() {
    if (!manifest) return;
    setSaveResult(null);
    setError(null);
    setSaveViewOpen(true);
  }

  async function retryFailedMedia() {
    if (!service || !preview) return;
    const revision = writeRevision.current;
    setBusy(true);
    setError(null);
    setSaved(null);
    setSaveProgress("Replanning the existing note and failed attachments…");
    try {
      const nextManifest = await service.planPreview(preview, { folderPath, mediaPolicy, templateId,
        targetNotePath: saved?.write.file.path ?? manifest?.notePath });
      if (revision !== writeRevision.current) return;
      setManifest(nextManifest);
      await saveManifest(nextManifest);
    } catch (caught) {
      if (revision === writeRevision.current) setError(message(caught));
    } finally {
      if (revision === writeRevision.current) setBusy(false);
    }
  }

  function clearUrl() {
    sourceRevision.current += 1;
    writeRevision.current += 1;
    setUrl("");
    setPreview(null);
    setManifest(null);
    setSaved(null);
    setSaveProgress(null);
    setError(null);
    setBusy(false);
    urlInputRef.current?.focus();
  }

  if (saveViewOpen && preview && manifest) return <BatchSaveView
    entries={[{ preview, manifest }]}
    progress={saveProgress ? { [manifest.contentKey]: saveProgress } : {}}
    result={saveResult} saving={saving} error={error}
    onBack={() => setSaveViewOpen(false)} onSave={() => { if (!saving) void saveManifest(manifest); }}
    onRetry={() => void retryFailedMedia()} onOpenNote={onOpenNote}
  />;

  return (
    <div className={`agentlens-pane agentlens-single-pane${preview ? " has-preview" : ""}${signedIn ? "" : " has-demo-help"}`}>
      <div className="agentlens-master-detail">
        <form className="agentlens-source-card" onSubmit={(event) => void fetchPreview(event)}>
          <div className="agentlens-url-bar">
          <label className="agentlens-sr-only" htmlFor="agentlens-single-url">Public post URL</label>
          <input
            id="agentlens-single-url"
            ref={urlInputRef}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste a public post URL…"
            value={signedIn ? url : SINGLE_DEMO_LINK}
            onChange={(event) => {
              sourceRevision.current += 1;
              writeRevision.current += 1;
              setUrl(event.currentTarget.value);
              setPreview(null);
              setManifest(null);
              setSaved(null);
              setSaveProgress(null);
              setError(null);
              setFetchFailure(null);
              setBusy(false);
            }}
            onPaste={event=>{if(!signedIn){event.preventDefault();onRequestSignUp?.();}}}
            onKeyDown={event=>{if(!signedIn && event.key.length===1 && !event.metaKey && !event.ctrlKey && !event.altKey){event.preventDefault();onRequestSignUp?.();}}}
            readOnly={!signedIn || saving}
            aria-describedby="agentlens-demo-help"
          />
          {signedIn && url && <button type="button" className="agentlens-clear-input" aria-label="Clear URL" disabled={saving} onClick={clearUrl}>×</button>}
          <button type="submit" className="mod-cta" disabled={busy || retryBlocked || !service || !targetUrl || signedIn && !operationAvailable(capabilities, "single", service.clientVersion())} aria-label={signedIn ? "Fetch preview" : "Fetch demo"} aria-busy={busy}>{busy ? "Parsing…" : signedIn ? "Parse" : "Try this link"}</button>
          </div>
          <p id="agentlens-demo-help" className={`setting-item-description agentlens-demo-help${signedIn ? " agentlens-sr-only" : ""}`}>
            {signedIn ? "AgentLens will parse this public URL after you submit it." : <><img src={demoBlockIcon} alt="" /><span>try this link for a demo preview, or <button type="button" className="agentlens-inline-signup" onClick={onRequestSignUp}>sign up</button> to start free with real links.</span></>}
          </p>

          {busy && !saving && <p className="agentlens-parse-status" role="status">Fetching your post… This can take a moment.</p>}
          {error && <p className="agentlens-inline-error" role="alert">{error}</p>}
        </form>

        {!signedIn && !preview ? <WorkflowOnboarding variant="single" onRequestSignUp={onRequestSignUp} /> : <section className={`agentlens-preview-card${preview ? " is-populated" : " is-empty"}`}>
          {preview && manifest ? (
            <>
              <div ref={summaryRef} className="agentlens-post-summary">
                {preview.post.media[0] && <RemoteThumbnail url={preview.post.media[0].thumbnailUrl ?? preview.post.media[0].coverUrl} kind={preview.post.media[0].kind} postCover />}
                <div><p className="agentlens-eyebrow"><PlatformIcon variant="author" id={preview.post.platform} />{preview.post.author.displayName.trim() || (preview.post.author.handle?.trim() ? `@${preview.post.author.handle.trim().replace(/^@/, "")}` : "Creator")}</p>
                <h3>{postDisplayTitle(preview.post)}</h3>
                <div className="agentlens-post-tags">{postContentTags(preview.post).map(tag => <span key={tag}>#{tag}</span>)}</div></div>
              </div>
              <div className="agentlens-single-controls" style={mediaControlStyle}>
                <label>Template<select aria-label="Note template" disabled={saving} value={templateId} onChange={(event) => { writeRevision.current += 1; setBusy(false); setTemplateId(event.currentTarget.value as TemplateId); }}>
                  <option value="default">Default template</option>
                </select></label>
                <fieldset><legend className="agentlens-sr-only">Media files</legend><span aria-hidden="true">Media files</span>
                  {([['download_all', 'Download available'], ['link_only', 'Link only'], ...(mediaPolicy === 'download_images_only' ? [['download_images_only', 'Images only']] : [])] as const).map(([value, label]) => <label key={value} className={mediaPolicy === value ? 'is-selected' : ''}><input type="radio" name="single-media-policy" disabled={saving} value={value} checked={mediaPolicy === value} onChange={() => { writeRevision.current += 1; setBusy(false); setMediaPolicy(value as MediaPolicy); }} />{label}</label>)}
                </fieldset>
              </div>
              <div className="agentlens-single-document" tabIndex={0} aria-label="Rendered note">
                <NoteProperties frontmatter={manifest.frontmatter} /><MarkdownPreview markdown={renderNotePreview(preview.post, manifest, saved?.write.ledger.attachmentPaths)} sourcePath={manifest.notePath} />
              </div>
              <footer className="agentlens-single-footer">
                <FolderField label="Folder" compact value={folderPath} onChange={(path) => { if (saving) return; writeRevision.current += 1; setBusy(false); setFolderPath(path); }} />
                <button type="button" disabled={busy} onClick={() => { sourceRevision.current += 1; writeRevision.current += 1; setPreview(null); setManifest(null); setSaved(null); setSaveProgress(null); }}>Cancel</button>
                <button type="button" className="mod-cta" aria-label="Save" onClick={() => { if (saving || saved) setSaveViewOpen(true); else savePreview(); }} disabled={!saving && (busy || manifest.action === "blocked")}>{saving ? "View progress" : saved ? "View results" : "Save"}</button>
              </footer>
              {saveProgress && <p role="status">{saveProgressLabel(saveProgress)}</p>}

            </>
) : (
            <>
              <div className="agentlens-empty-proof" aria-hidden="true" />
              <h3>Paste a link to begin</h3>
              <p>AgentLens parses the source first. Nothing is written<br />to your Vault until you click Save.</p>
            </>
)}
        </section>}
      </div>
    </div>
);
}
