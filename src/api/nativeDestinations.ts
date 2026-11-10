export interface DestinationRegistration {
  targetId: string; name: string; writable: boolean; folders: Array<{id: string; path: string}>;
}
export interface DestinationBinding {
  bindingId: string; followId: string; installationId: string; targetId: string;
  saveFolderId: string; saveFolderPath: string; noteTemplateId: string; mediaPolicy: string;
  bindingVersion: string; configurationState: string;
  recordType?: "binding" | "configuration"; activationState?: string;
}
export function validateDestinationBindings(value: unknown): DestinationBinding[] {
  if (!Array.isArray(value)) throw new Error("Invalid destination configuration list.");
  const ids = new Set<string>();
  return (value as unknown[]).map(item => {
    if (!item || typeof item !== "object") throw new Error("Invalid destination identity.");
    const row = item as Record<string, unknown>;
    if (!row || ["bindingId","followId","installationId","targetId","bindingVersion","noteTemplateId","mediaPolicy","configurationState"].some(k => typeof row[k] !== "string" || !row[k])
        || typeof row.saveFolderId !== "string" || typeof row.saveFolderPath !== "string" || typeof row.bindingId !== "string" || ids.has(row.bindingId)) throw new Error("Invalid destination identity.");
    if(row.recordType !== undefined && row.recordType !== "binding" && row.recordType !== "configuration") throw new Error("Invalid destination record type.");
    ids.add(row.bindingId); return row as unknown as DestinationBinding;
  });
}
export function matchesDestination(row: DestinationBinding, creator: {creatorId: string; targetId?: string | null | undefined; saveFolderId: string; saveFolderPath: string; noteTemplateId?: string | null | undefined; mediaPolicy?: string | null | undefined}): boolean {
  return row.bindingId === creator.creatorId && row.targetId === creator.targetId && row.saveFolderId === creator.saveFolderId
    && row.saveFolderPath === creator.saveFolderPath && row.noteTemplateId === (creator.noteTemplateId ?? "default")
    && row.mediaPolicy === (creator.mediaPolicy ?? "download_all");
}
