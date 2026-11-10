import type { SaveTransferProgress } from "../../workbench/types";
import type { NoteWriteManifest } from '../../vault/VaultWriter';
import { userMessage } from '../../core/user-feedback';

export function plannedDownloadCount(manifest: NoteWriteManifest): number {
  if (manifest.action === "skip" || manifest.action === "blocked") return 0;
  return manifest.attachments.filter(attachment => attachment.action === "new").length;
}

export function attachmentDownloadLabel(transfer: SaveTransferProgress): string {
  const { receivedBytes, totalBytes } = transfer;
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  const received = `Downloading · ${mb(receivedBytes)} MB`;
  if (!totalBytes) return received;
  const percent = Math.min(100, Math.floor(receivedBytes / totalBytes * 100));
  return `${received} / ${mb(totalBytes)} MB · ${percent}%`;
}

/** Presentation only. The writer's progress tokens remain the state protocol. */
export function saveProgressLabel(progress: string): string {
  if (/^Writing note\b/.test(progress)) return 'Saving note…';
  if (/^partial\b/.test(progress)) return 'Note saved. Some files couldn’t be saved. Review the results.';
  if (/^skipped_duplicate\b/.test(progress)) return 'Already saved. No action is needed.';
  if (/^(written|updated)\b/.test(progress)) return /[1-9]\d* failed/.test(progress)
    ? 'Note saved. Some files couldn’t be saved. Review the results.'
    : 'Note saved. No action is needed.';
  return userMessage(progress, 'save');
}
export function savePlanReason(manifest: NoteWriteManifest): string {
  if (manifest.action === 'blocked') return 'This note belongs to other content. Review it before saving.';
  if (manifest.partialReasons.some(reason => reason.includes('host limit'))) return 'Some files are too large to download. Their links will be saved.';
  if (manifest.partialReasons.length) return 'Some download links have expired. Load the post again.';
  if (manifest.action === 'skip') return 'Already saved. No changes are needed.';
  if (manifest.action === 'update') return 'The saved note will be updated.';
  return 'A new note will be saved.';
}
