import {validateRelativeFolder} from "../auto-fetch/shared-folder";
export interface SharedSettings {followId: string; configRevision: number; taskTimeZone: string | null; relativeFolderPath: string | null; pathRevision: number}
export function validateSharedSettings(value: unknown): SharedSettings[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Invalid shared settings snapshot.");
  const seen = new Set<string>();
  return value.map(v => {
    const row = v as SharedSettings;
    if (!row || typeof row.followId !== "string" || !row.followId || seen.has(row.followId)
        || !Number.isSafeInteger(row.configRevision) || row.configRevision < 1
        || !Number.isSafeInteger(row.pathRevision) || row.pathRevision < 0
        || (row.relativeFolderPath !== null && (typeof row.relativeFolderPath !== "string" || row.pathRevision < 1)))
      throw new Error("Invalid shared settings identity or revision.");
    if (row.relativeFolderPath !== null) validateRelativeFolder(row.relativeFolderPath);
    if (row.taskTimeZone !== null) {
      if (typeof row.taskTimeZone !== "string") throw new Error("Invalid task timezone.");
      new Intl.DateTimeFormat("en", {timeZone: row.taskTimeZone});
    }
    seen.add(row.followId);return row;
  });
}
