/** Persisted source projection and bounded queue facts; neither proves live work. */
export interface CreatorLocalStatus {
  runState?: string | undefined;
  lastFetchRunSequence?: number | undefined;
  lastError?: string | undefined;
  retryAt?: string | undefined;
  lastSuccessfulCheckAt?: string | undefined;
  statusResetAt?: string | undefined;
  statusResetSequence?: number | undefined;
  statusResetSuperseded?: boolean | undefined;
  checkQueued?: boolean | undefined;
  saveQueued?: boolean | undefined;
  writeFailed?: boolean | undefined;
  writeUnknown?: boolean | undefined;
  receiptPending?: boolean | undefined;
}
