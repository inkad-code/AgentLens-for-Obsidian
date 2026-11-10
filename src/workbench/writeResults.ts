import type { CreatorUpdatePage, WriteResultInput, WriteResultsRequest, MediaWriteResultInput } from "../api/AgentLensApiClient";
import type { VaultWriteResult } from "../vault/VaultWriter";

export function mediaWriteResults(write: VaultWriteResult): readonly MediaWriteResultInput[] {
  return write.attachments.map(item => ({ mediaId: item.mediaId,
    status: item.status === "skipped" ? "reused" : item.status === "failed" && item.failureKind === "write_unknown" ? "unknown"
      : item.status === "linked" && write.manifest.attachments.find(original => original.mediaId === item.mediaId)?.partialReason ? "failed" : item.status }));
}

export function writeResult(write: VaultWriteResult): WriteResultInput {
  const attachmentSaved = write.attachments.some((attachment) => attachment.status === "saved");
  return {
    media: mediaWriteResults(write),
    contentKey: write.ledger.contentKey,
    notePath: write.ledger.notePath,
    status: write.manifest.action === "skip" && !attachmentSaved && !write.recovered
      ? "skipped"
      : write.ledger.completion === "partial" ? "partial" : "success",
    ...(write.ledger.completion === "partial" ? { errorCode: "MEDIA_PARTIAL" } : {})
  };
}

export function autoWriteRequest(
  page: CreatorUpdatePage,
  reason: string,
  results: readonly WriteResultInput[]
): WriteResultsRequest {
  return {
    fetchId: page.fetchId,
    creatorId: page.creatorId,
    fetchRunId: page.fetchRunId,
    runComplete: page.deliveryItemKey === undefined && !page.hasMore,
    ...(page.requestId ? { requestId: page.requestId } : {}),
    coverageComplete: page.coverageComplete,
    truncated: page.truncated,
    stopReason: page.stopReason ?? reason,
    runId: page.leaseId,
    results
  };
}
