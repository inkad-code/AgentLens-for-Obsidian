import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { ACCOUNT_TRANSCRIPT_CREDITS, transcriptTimestamp, type TranscriptReceipt, type TranscriptScope } from "../../api/transcript";
import type { AgentLensWorkbenchPort } from "../../workbench/ports";
import type { PreviewResult, SaveResult } from "../../workbench/types";
import type { TrialUi } from "../../workbench/ManualTrial";
import type { WorkbenchDefaults } from "./types";
import { WorkbenchDialog } from "./WorkbenchDialog";

type Props = {
  service?: AgentLensWorkbenchPort | undefined;
  signedIn: boolean;
  accountId?: string | undefined;
  trial?: TrialUi | undefined;
  defaults: WorkbenchDefaults;
  onSignIn: () => void;
  onBalanceChanged: () => void;
  onTrialSaved: () => void;
  onOpenNote?: ((path: string) => void) | undefined;
};

type Selected = { scope: TranscriptScope; receipt: TranscriptReceipt };
type Intent = { scope: TranscriptScope; sourceUrl: string; key: string };
type TranscriptState = TranscriptReceipt["caption"]["status"];

const childLabels: Record<TranscriptState, string> = {
  processing: "Retrieving…",
  unknown: "Awaiting confirmation",
  ready: "Available",
  empty: "Nothing returned",
  failed: "Failed · no charge for this request",
};

export function TranscriptPane({ service, signedIn, accountId, trial, defaults, onSignIn,
  onBalanceChanged, onTrialSaved, onOpenNote }: Props) {
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<Selected>();
  const [intent, setIntent] = useState<Intent>();
  const [confirming, setConfirming] = useState<Intent>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [trackId, setTrackId] = useState("");
  const [includeVideo, setIncludeVideo] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult>();
  const inputId = useId();
  const revision = useRef(0);
  const busyRef = useRef(false);
  const saveAbort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => {
      ++revision.current;
      saveAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    ++revision.current;
    saveAbort.current?.abort();
    busyRef.current = false;
    setSelected(undefined);
    setIntent(undefined);
    setConfirming(undefined);
    setSaveResult(undefined);
    setBusy(false);
    setMessage("");
    setError("");
  }, [signedIn, accountId]);

  const scope: TranscriptScope = signedIn ? "account" : "trial";
  const trialAvailable = trial?.mode === "B" && !trial.balance?.accountLinked && (trial.balance?.remaining ?? 0) > 0;
  const receipt = selected?.receipt;
  const tracks = receipt?.caption.status === "ready" ? receipt.caption.result.tracks : [];
  const track = tracks.find(candidate => candidate.id === trackId) ?? tracks[0];
  const video = receipt?.video.status === "ready" ? receipt.video.result : undefined;
  const pending = receipt?.status === "processing" || receipt?.status === "unknown";

  function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const version = revision.current;
    void action().catch(cause => {
      if (version === revision.current) setError(cause instanceof Error ? cause.message : "Transcript could not be opened.");
    }).finally(() => {
      if (version === revision.current) {
        busyRef.current = false;
        setBusy(false);
      }
    });
  }

  function show(next: TranscriptReceipt, nextScope: TranscriptScope) {
    setUrl(next.sourceUrl);
    setSelected({ scope: nextScope, receipt: next });
    setIntent(undefined);
    setSaveResult(undefined);
  }

  function ask(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!service?.startTranscript || !url.trim() || (!signedIn && !trialAvailable)) return;
    const sourceUrl = url.trim();
    setConfirming(intent?.sourceUrl === sourceUrl && intent.scope === scope ? intent : { scope, sourceUrl, key: crypto.randomUUID() });
  }

  function confirm() {
    if (!confirming || !service?.startTranscript) return;
    const start = service.startTranscript.bind(service);
    const proposed = confirming;
    const version = revision.current;
    setConfirming(undefined);
    setIntent(proposed);
    run(async () => {
      try {
        const next = await start(proposed.sourceUrl, proposed.key, proposed.scope);
        if (version === revision.current) {
          setTrackId("");
          setIncludeVideo(false);
          show(next, proposed.scope);
        }
      } finally {
        if (version === revision.current) onBalanceChanged();
      }
    });
  }

  function restore(target: TranscriptScope) {
    if (!service?.latestTranscript) return;
    const version = revision.current;
    run(async () => {
      const next = await service.latestTranscript!(target);
      if (version !== revision.current) return;
      if (!next) { setMessage("No saved transcript was found."); return; }
      setTrackId("");
      setIncludeVideo(false);
      show(next, target);
      onBalanceChanged();
    });
  }

  function recover() {
    const task = selected ? { scope: selected.scope, key: selected.receipt.requestKey } : intent;
    if (!service?.recoverTranscript || !task) return;
    const version = revision.current;
    run(async () => {
      const next = await service.recoverTranscript!(task.scope, task.key);
      if (version !== revision.current) return;
      show(next, task.scope);
      onBalanceChanged();
    });
  }

  function save() {
    if (busyRef.current || !service || !receipt || !selected || (!track && (!video || !includeVideo))) return;
    const version = revision.current;
    const preview: PreviewResult = {
      demo: false,
      transcript: true,
      trial: selected.scope === "trial",
      post: {
        platform: receipt.platform,
        contentId: `transcript-${receipt.operationId}`,
        canonicalUrl: receipt.sourceUrl,
        title: receipt.caption.status === "ready" ? receipt.caption.result.title : video?.title ?? "Video transcript",
        text: track ? track.lines.map(line => `[${transcriptTimestamp(line.from)}] ${line.text.replace(/[\r\n]+/g, " ").replace(/[\\<>`*_[\]]/g, "\\$&")}`).join("\n\n") : "",
        author: { id: receipt.platform, displayName: receipt.platform === "youtube" ? "YouTube" : "Bilibili" },
        media: includeVideo ? video?.media ?? [] : [],
      },
    };
    const controller = new AbortController();
    saveAbort.current = controller;
    setSaveResult(undefined);
    run(async () => {
      try {
        const manifest = await service.planPreview(preview, {
          folderPath: defaults.folderPath, templateId: defaults.templateId, mediaPolicy: defaults.mediaPolicy
        });
        const result = await service.savePrepared([{ preview, manifest }], undefined, { signal: controller.signal });
        if (version !== revision.current || controller.signal.aborted) return;
        const saved = result.successes[0];
        if (!saved) throw new Error(result.failures[0]?.error ?? "The transcript note could not be written.");
        setSaveResult(saved);
        if (!signedIn && preview.trial && saved.write.ledger.physicalStatus === "active"
            && await service.claimTrialSavePrompt?.().catch(() => false) && version === revision.current) onTrialSaved();
      } finally {
        if (saveAbort.current === controller) saveAbort.current = undefined;
      }
    });
  }

  return <div className="agentlens-single-pane agentlens-transcript-pane">
    <form className="agentlens-transcript-form" onSubmit={ask}>
      <label htmlFor={inputId}>YouTube or Bilibili video link</label>
      <div className="agentlens-url-bar">
        <input id={inputId} value={url} onChange={event => setUrl(event.target.value)} disabled={busy} />
        <button type="submit" className="mod-cta" disabled={!service?.startTranscript || busy || !url.trim() || (!signedIn && !trialAvailable)}>
          Retrieve transcript
        </button>
      </div>
    </form>
    <div className="agentlens-transcript-actions">
      {signedIn && <button type="button" disabled={busy} onClick={() => restore("account")}>Restore last transcript</button>}
      {trial?.mode === "B" && (!trial.balance?.accountLinked || signedIn)
        && <button type="button" disabled={busy} onClick={() => restore("trial")}>Restore trial transcript</button>}
      {(!signedIn && !trialAvailable) && <button type="button" onClick={onSignIn}>Sign in to retrieve a transcript</button>}
      {(pending || (!selected && intent)) && <button type="button" disabled={busy} onClick={recover}>Check original task</button>}
    </div>
    {busy && <p role="status">Working…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="agentlens-inline-error" role="alert">{error}</p>}
    {receipt && <section aria-label="Transcript result">
      <h3>{receipt.caption.status === "ready" ? receipt.caption.result.title : video?.title ?? "Transcript result"}</h3>
      <dl className="agentlens-transcript-results">
        <div><dt>Official subtitles</dt><dd>{childLabels[receipt.caption.status]}</dd></div>
        <div><dt>Video link</dt><dd>{childLabels[receipt.video.status]}</dd></div>
      </dl>
      <p role="status">{receipt.balance
        ? `${receipt.usedTrial} trial ${receipt.usedTrial === 1 ? "use" : "uses"} used`
        : `${receipt.chargedCredits} ${receipt.chargedCredits === 1 ? "credit" : "credits"} charged`}{pending ? " · The original task can still be checked." : "."}</p>
      {track && <>
        <label>Subtitle language <select value={track.id} onChange={event => { setTrackId(event.target.value); setSaveResult(undefined); }} disabled={busy}>
          {tracks.map(candidate => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}
        </select></label>
        <ol className="agentlens-transcript-cues">
          {track.lines.map((cue, index) => <li key={index}><time>{transcriptTimestamp(cue.from)}</time><span>{cue.text}</span></li>)}
        </ol>
      </>}
      {video && <label className="agentlens-transcript-video"><input type="checkbox" checked={includeVideo} onChange={event => { setIncludeVideo(event.target.checked); setSaveResult(undefined); }} disabled={busy} /> Include video in note</label>}
      {(track || video) && <div className="agentlens-transcript-actions">
        <button type="button" className="mod-cta" onClick={save} disabled={busy || (!track && !includeVideo)}>Save transcript note</button>
        {saveResult && <button type="button" onClick={() => onOpenNote?.(saveResult.write.ledger.notePath)}>Open saved note</button>}
      </div>}
      {saveResult && <p role="status">{saveResult.write.ledger.completion === "partial" ? "Note saved. Some attachments could not be written." : "Note saved."}</p>}
    </section>}
    {confirming && <WorkbenchDialog title="Retrieve transcript" compact onClose={() => setConfirming(undefined)}>
      <p>{confirming.scope === "account" ? `Reserve ${ACCOUNT_TRANSCRIPT_CREDITS} credits.` : "Reserve 1 trial use."}
        {" "}Official subtitles and the video link are retrieved separately. A successful response can return no content.</p>
      <p>{confirming.scope === "account" ? "Each successful response uses 1 credit." : "Any successful response uses 1 trial use total."}</p>
      <div className="agentlens-dialog-actions">
        <button type="button" onClick={() => setConfirming(undefined)}>Cancel</button>
        <button type="button" className="mod-cta" onClick={confirm}>Confirm retrieval</button>
      </div>
    </WorkbenchDialog>}
  </div>;
}
