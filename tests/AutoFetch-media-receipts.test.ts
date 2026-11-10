import { expect, it } from "vitest";
import { writeResult } from "@/workbench/writeResults";
import type { VaultWriteResult } from "@/vault/VaultWriter";

it("reports every attachment's physical or policy outcome without treating partial fallback links as success", () => {
  const write = { manifest: { action: "new", attachments: [{ mediaId: "fallback", partialReason: "Media unavailable" }] },
    ledger: { contentKey: "youtube:post", notePath: "Research/post.md", completion: "partial" }, attachments: [
      { mediaId: "saved", status: "saved", path: "Research/saved.png" },
      { mediaId: "reused", status: "skipped", path: "Research/reused.png" },
      { mediaId: "policy", status: "linked", path: "Research/policy.mp4" },
      { mediaId: "fallback", status: "linked", path: "Research/fallback.mp4" },
      { mediaId: "failed", status: "failed", path: "Research/failed.png", failureKind: "retryable" },
      { mediaId: "unknown", status: "failed", path: "Research/unknown.png", failureKind: "write_unknown" }
    ] } as unknown as VaultWriteResult;
  expect(writeResult(write)).toEqual({ contentKey: "youtube:post", notePath: "Research/post.md", status: "partial", errorCode: "MEDIA_PARTIAL",
    media: [{ mediaId: "saved", status: "saved" }, { mediaId: "reused", status: "reused" }, { mediaId: "policy", status: "linked" },
      { mediaId: "fallback", status: "failed" }, { mediaId: "failed", status: "failed" }, { mediaId: "unknown", status: "unknown" }] });
});
