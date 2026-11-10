import type { SaveTransferProgress } from "../../workbench/types";
import { userMessage } from "../../core/user-feedback";
import { attachmentDownloadLabel, plannedDownloadCount, savePlanReason } from "./savePresentation";
import { useState } from 'react';
import type { BatchSaveResult, PreparedSave } from '../../workbench/types';
import { contentKey, postDisplayTitle, postThumbnailUrl } from '../../core/domain';
import { RemoteThumbnail } from './shared';
import { saveAssets, saveSuccessCheck } from './saveAssets';
import { useI18n } from "../../i18n/I18nProvider";

export type BatchSaveEntry = PreparedSave & { displayTitle?: string };

export function BatchSaveView({entries,progress,result,saving,error,onBack,onSave,onRetry,onOpenNote,transfers,downloadTotal,onCancel,cancelling = false}: {
  transfers?: Readonly<Record<string, SaveTransferProgress>> | undefined;
  downloadTotal?: number | undefined;
  onCancel?: () => void;
  cancelling?: boolean;
  entries: readonly BatchSaveEntry[];
  progress: Readonly<Record<string,string>>;
  result: BatchSaveResult | null;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSave: () => void;
  onRetry: () => void;
  onOpenNote?: ((path:string)=>void) | undefined;
}) {
  const { t } = useI18n();
  const [selectedPath,setSelectedPath]=useState<string | null>(null);
  const total = downloadTotal ?? entries.reduce((count, { manifest }) => count + plannedDownloadCount(manifest), 0);
  const downloaded = Object.values(transfers ?? {}).reduce((count, transfer) => count + transfer.downloadedCount, 0);
  const successfulPath=selectedPath ?? result?.successes[0]?.write.file.path;
  const retryable=Boolean(result && (result.failures.length || result.successes.some(item=>item.write.ledger.completion==='partial')));
  return <section className={`agentlens-batch-save-view${result ? " is-result" : ""}`} aria-label="Save plan and results">
    <header><h3>Save plan / results</h3><p>The following will be written to your Vault. Successful items will not be rolled back.</p></header>
    {saving && <div className="agentlens-batch-progress">
      <div><span>Downloaded</span><span>{downloaded}/{total}</span></div>
      {total > 0 && <progress aria-label="Downloaded attachments" max={total} value={downloaded} />}
    </div>}
    <div className="agentlens-save-plan-list">{entries.map(({preview,manifest,displayTitle},index)=>{
      const saved=result?.successes.find(item=>item.write.ledger.contentKey===manifest.contentKey);
      const failure=result?.failures.find(item=>contentKey(item.preview.post)===contentKey(preview.post));
      const current=progress[manifest.contentKey] ?? '';
      const detailsStatus = saving && (current === "waiting-for-details" ? t("bulk.saveWaitingForDetails")
        : current === "loading-details" ? t("bulk.saveLoadingDetails") : undefined);
      const failed=Boolean(failure) || /^failed\b/.test(current);
      const complete=Boolean(saved) || /^(written|updated|skipped_duplicate|partial)\b/.test(current);
      const partial=saved?.write.ledger.completion==='partial' || /^partial\b/.test(current);
      const transfer = transfers?.[manifest.contentKey];
      const active = saving && (Boolean(transfer?.downloading) || (!complete && !failed && /^Writing note/.test(current)));
      const downloading = active && transfer?.downloading && !cancelling;
      const transferLabel = downloading ? attachmentDownloadLabel(transfer) : undefined;
      const downloadCount = saving && transfer && `Downloaded ${transfer.downloadedCount}/${transfer.attachmentCount}`;
      const failedMedia=saved?.write.attachments.some(item=>item.status==='failed');
      const details=failure || failed ? userMessage(failure?.error ?? current, 'save')
        : failedMedia ? 'Note saved. Some files couldn’t be saved. Retry the partial note.'
        : manifest.action==='blocked' || manifest.partialReasons.length ? savePlanReason(manifest) : '';
      const path=manifest.notePath.split('/').slice(0,-1).join(' / ');
      const title = displayTitle ?? postDisplayTitle(preview.post);
      return <article key={manifest.contentKey} className={`agentlens-save-plan-row${active?' is-writing':''}${failed?' is-failed':''}`} >
        <div className="agentlens-save-plan-thumbnail"><RemoteThumbnail url={postThumbnailUrl(preview.post)} kind={preview.post.media[0]?.kind ?? 'Text only'} /><span className="agentlens-save-plan-index">{index+1}</span></div>
        <div className="agentlens-save-plan-copy"><h4 title={title}>{saved ? <button type="button" title={title} aria-pressed={successfulPath===saved.write.file.path} onClick={()=>setSelectedPath(saved.write.file.path)}>{title}</button> : title}</h4><p><img src={saveAssets.imgIconFolder} alt="" />{path || 'Vault root'}</p><p><img src={saveAssets.imgTemplateIcon} alt="" />Default template</p>{downloadCount && <p>{downloadCount}{transferLabel && ` · ${transferLabel}`}</p>}</div>
        {(failed || complete || active || detailsStatus || manifest.action==='blocked') && <span className={`agentlens-save-plan-status ${failed || manifest.action==='blocked'?'is-failed':partial?'is-partial':complete?'is-success':'is-writing'}`}>{failed?'× Failed':manifest.action==='blocked'?'Blocked':partial?'Partial':complete?<><img src={saveSuccessCheck} width="12" height="12" alt="" />Success</>:detailsStatus || 'Saving…'}</span>}
        {downloading && <progress className="agentlens-row-progress" aria-label={transferLabel}
          max={transfer.totalBytes || undefined} value={transfer.totalBytes ? transfer.receivedBytes : undefined} />}
        {details && <p className="agentlens-save-plan-error" role={failure ? "alert" : undefined}>{details}</p>}
      </article>;
    })}</div>
    {error && <p className="agentlens-inline-error" role="alert">{error}</p>}
    {result && <p className="agentlens-sr-only" role="status">{result.successes.filter(saved=>saved.write.ledger.status!=='skipped_duplicate').length} saved; {result.successes.filter(saved=>saved.write.ledger.status==='skipped_duplicate').length} already saved ({result.successes.filter(saved=>saved.write.ledger.completion==='partial').length} partial); {result.failures.length} failed. Successful notes were not rolled back.</p>}
    <footer className="agentlens-batch-save-footer">
      {!result && <div className="agentlens-save-plan-counts"><strong>Selected {entries.length}</strong><span>{entries.filter(entry=>entry.manifest.action==='new' && !entry.manifest.alreadySaved).length} New</span><span>{entries.filter(entry=>entry.manifest.alreadySaved || ['skip','update'].includes(entry.manifest.action)).length} Already saved</span>{entries.some(entry=>entry.preview.post.media.length>0) && <span>{entries.filter(entry=>entry.preview.post.media.length>0).length} Has media</span>}</div>}
      {retryable && <button type="button" onClick={onRetry} disabled={saving}>Retry failed and partial notes</button>}
      {result && <button type="button" onClick={()=>{if(successfulPath)onOpenNote?.(successfulPath);}} disabled={!onOpenNote || !successfulPath}>Open note</button>}
      {saving && onCancel && <button type="button" onClick={onCancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel"}</button>}
      {!result && <button type="button" onClick={onBack} aria-label="Back to loaded posts">Back</button>}
      <button type="button" className="mod-cta" onClick={result ? onBack : onSave} disabled={saving || (!result && entries.some(entry=>entry.manifest.action==='blocked'))} aria-label={saving?"Saving":result?"Close save results":`Save ${entries.length} notes to vault`}>{saving?"Saving":result?"Close":"Save"}</button>
    </footer>
  </section>;
}
