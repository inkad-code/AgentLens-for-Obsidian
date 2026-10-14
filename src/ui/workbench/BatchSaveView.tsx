import { userMessage } from "../../core/user-feedback";
import { savePlanReason } from "./savePresentation";
import { useState } from 'react';
import type { BatchSaveResult, PreparedSave } from '../../workbench/types';
import { contentKey, postDisplayTitle, postThumbnailUrl } from '../../core/domain';
import { RemoteThumbnail } from './shared';
import { saveAssets, saveSuccessCheck } from './saveAssets';

export function BatchSaveView({entries,progress,result,saving,error,onBack,onSave,onRetry,onOpenNote}: {
  entries: readonly PreparedSave[];
  progress: Readonly<Record<string,string>>;
  result: BatchSaveResult | null;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSave: () => void;
  onRetry: () => void;
  onOpenNote?: ((path:string)=>void) | undefined;
}) {
  const [selectedPath,setSelectedPath]=useState<string | null>(null);
  const completed=entries.filter(({manifest})=>/^(written|updated|skipped_duplicate|partial|failed)\b/.test(progress[manifest.contentKey] ?? '')).length;
  const progressPercent=entries.length ? Math.round(completed/entries.length*100) : 0;
  const successfulPath=selectedPath ?? result?.successes[0]?.write.file.path;
  const retryable=Boolean(result && (result.failures.length || result.successes.some(item=>item.write.ledger.completion==='partial')));
  return <section className={`agentlens-batch-save-view${result ? " is-result" : ""}`} aria-label="Save plan and results">
    <header><h3>Save plan / results</h3><p>The following will be written to your Vault. Successful items will not be rolled back.</p></header>
    {saving && <div className="agentlens-batch-progress"><div><span>Progress</span><span>{completed}/{entries.length} · {progressPercent}%</span></div><progress aria-label="Batch save progress" aria-valuetext={`${completed} of ${entries.length}, ${progressPercent}%`} max={entries.length} value={completed} /></div>}
    <div className="agentlens-save-plan-list">{entries.map(({preview,manifest},index)=>{
      const saved=result?.successes.find(item=>item.write.ledger.contentKey===manifest.contentKey);
      const failure=result?.failures.find(item=>contentKey(item.preview.post)===contentKey(preview.post));
      const current=progress[manifest.contentKey] ?? '';
      const failed=Boolean(failure) || /^failed\b/.test(current);
      const complete=Boolean(saved) || /^(written|updated|skipped_duplicate|partial)\b/.test(current);
      const partial=saved?.write.ledger.completion==='partial' || /^partial\b/.test(current);
      const active=saving && !complete && !failed && /^Writing note/.test(current);
      const failedMedia=saved?.write.attachments.some(item=>item.status==='failed');
      const details=failure || failed ? userMessage(failure?.error ?? current, 'save')
        : failedMedia ? 'Note saved. Some files couldn’t be saved. Retry the partial note.'
        : manifest.action==='blocked' || manifest.partialReasons.length ? savePlanReason(manifest) : '';
      const path=manifest.notePath.split('/').slice(0,-1).join(' / ');
      const title=postDisplayTitle(preview.post);
      return <article key={manifest.contentKey} className={`agentlens-save-plan-row${active?' is-writing':''}${failed?' is-failed':''}`} >
        <div className="agentlens-save-plan-thumbnail"><RemoteThumbnail url={postThumbnailUrl(preview.post)} kind={preview.post.media[0]?.kind ?? 'Text only'} /><span className="agentlens-save-plan-index">{index+1}</span></div>
        <div className="agentlens-save-plan-copy"><h4 title={title}>{saved ? <button type="button" title={title} aria-pressed={successfulPath===saved.write.file.path} onClick={()=>setSelectedPath(saved.write.file.path)}>{title}</button> : title}</h4><p><img src={saveAssets.imgIconFolder} alt="" />{path || 'Vault root'}</p><p><img src={saveAssets.imgTemplateIcon} alt="" />Default template</p></div>
        {(failed || complete || active || manifest.action==='blocked') && <span className={`agentlens-save-plan-status ${failed || manifest.action==='blocked'?'is-failed':partial?'is-partial':complete?'is-success':'is-writing'}`}>{failed?'× Failed':manifest.action==='blocked'?'Blocked':partial?'Partial':complete?<><img src={saveSuccessCheck} width="12" height="12" alt="" />Success</>:'Saving…'}</span>}
        {active && <progress className="agentlens-row-progress" aria-label={`Saving ${postDisplayTitle(preview.post)}`} />}
        {complete && saving && <progress className="agentlens-row-progress" max={1} value={1} aria-label={`Saved ${postDisplayTitle(preview.post)}`} />}
        {details && <p className="agentlens-save-plan-error">{details}</p>}
      </article>;
    })}</div>
    {error && <p className="agentlens-inline-error" role="alert">{error}</p>}
    {result && <p className="agentlens-sr-only" role="status">{result.successes.filter(saved=>saved.write.ledger.status!=='skipped_duplicate').length} saved; {result.successes.filter(saved=>saved.write.ledger.status==='skipped_duplicate').length} already saved ({result.successes.filter(saved=>saved.write.ledger.completion==='partial').length} partial); {result.failures.length} failed. Successful notes were not rolled back.</p>}
    <footer className="agentlens-batch-save-footer">
      {!result && <div className="agentlens-save-plan-counts"><strong>Selected {entries.length}</strong><span>{entries.filter(entry=>entry.manifest.action==='new' && !entry.manifest.alreadySaved).length} New</span><span>{entries.filter(entry=>entry.manifest.alreadySaved || ['skip','update'].includes(entry.manifest.action)).length} Already saved</span>{entries.some(entry=>entry.preview.post.media.length>0) && <span>{entries.filter(entry=>entry.preview.post.media.length>0).length} Has media</span>}</div>}
      {retryable && <button type="button" onClick={onRetry} disabled={saving}>Retry failed and partial notes</button>}
      {result && <button type="button" onClick={()=>{if(successfulPath)onOpenNote?.(successfulPath);}} disabled={!onOpenNote || !successfulPath}>Open note</button>}
      {!result && <button type="button" onClick={onBack} aria-label="Back to loaded posts">Back</button>}
      <button type="button" className="mod-cta" onClick={result ? onBack : onSave} disabled={saving || (!result && entries.some(entry=>entry.manifest.action==='blocked'))} aria-label={saving?"Saving":result?"Close save results":`Save ${entries.length} notes to vault`}>{saving?"Saving":result?"Close":"Save"}</button>
    </footer>
  </section>;
}
