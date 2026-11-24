import type { NormalizedMedia } from "../core/domain";
import type { TrialBalance } from "../workbench/ManualTrial";

export type TranscriptScope = "trial" | "account";

export type TranscriptIdentity =
  | { scope: "account"; token: string }
  | { scope: "trial"; credential: string; token?: string | undefined };

export type CaptionCue = { from: number; to: number; text: string };
export type CaptionTrack = { id: string; language: string; label: string; lines: readonly CaptionCue[] };

export type TranscriptChild<T> =
  | { status: "ready"; result: T }
  | { status: "processing" | "unknown" | "empty" | "failed"; result: null };

export type TranscriptReceipt = {
  operationId: string;
  requestKey: string;
  sourceUrl: string;
  platform: "youtube" | "bilibili";
  status: "processing" | "unknown" | "complete";
  caption: TranscriptChild<{ title: string; tracks: readonly CaptionTrack[] }>;
  video: TranscriptChild<{ title?: string | undefined; media: readonly NormalizedMedia[] }>;
  chargedCredits: number;
  usedTrial: number;
  balance: TrialBalance | null;
};

export interface TranscriptApi {
  start(identity: TranscriptIdentity, key: string, sourceUrl: string): Promise<TranscriptReceipt>;
  latest(identity: TranscriptIdentity): Promise<TranscriptReceipt | null>;
  recover(identity: TranscriptIdentity, key: string): Promise<TranscriptReceipt>;
}

export const ACCOUNT_TRANSCRIPT_CREDITS = 2;

export function transcriptTimestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const pad = (part: number) => String(part).padStart(2, "0");
  const minutes = pad(Math.floor(whole / 60) % 60);
  const suffix = `${minutes}:${pad(whole % 60)}`;
  return whole >= 3600 ? `${pad(Math.floor(whole / 3600))}:${suffix}` : suffix;
}
