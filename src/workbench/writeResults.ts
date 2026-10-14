import type { CreatorUpdatePage, WriteResultInput, WriteResultsRequest } from "../api/AgentLensApiClient";
import type { VaultWriteResult } from "../vault/VaultWriter";

export function writeResult(write: VaultWriteResult): WriteResultInput {
  const attachmentSaved = write.attachments.some((attachment) => attachment.status === "saved");
  return {
    contentKey: write.ledger.contentKey,
    notePath: write.ledger.notePath,
    status: write.manifest.action === "skip" && !attachmentSaved
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
    runComplete: !page.hasMore,
    ...(page.requestId ? { requestId: page.requestId } : {}),
    coverageComplete: page.coverageComplete,
    truncated: page.truncated,
    stopReason: page.stopReason ?? reason,
    runId: page.leaseId,
    results
  };
}
