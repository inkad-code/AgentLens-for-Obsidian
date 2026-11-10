export interface NativeExecutionTarget {
  name?: string;
  folders?: Array<{id: string; path: string}>;
  createFolder?: (path: string) => Promise<{id: string; path: string}>;
  targetId: string;
  healthy: boolean;
  writable: boolean;
}

export function requireMatchingExecutionTarget(snapshotTarget: string | undefined, currentTarget: string | undefined): void {
  if (snapshotTarget && snapshotTarget !== currentTarget)
    throw new Error("Open the original Vault before resuming this execution.");
}
