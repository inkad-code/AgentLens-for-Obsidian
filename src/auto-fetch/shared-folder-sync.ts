import {resolveSharedFolder, type FolderAdoption, type ResolvedFolder} from "./shared-folder";
import type {SharedSettings} from "../api/shared-settings";
export interface SharedLocalState {
  sharedFolderAdoptions?: Record<string, FolderAdoption>;
  sharedSettings?: Record<string, SharedSettings[]>;
}
type SyncInput = {
  owner: string; installation: string; product: string; targetId: string;
  snapshot(): Promise<SharedSettings[]>;
  load(): Promise<SharedLocalState>;
  update(action: (state: SharedLocalState) => void): Promise<void>;
  current(): Promise<void>;
  pending(followId: string): Promise<boolean>;
  folders(): Promise<readonly ResolvedFolder[]>;
  create(path: string): Promise<ResolvedFolder>;
  publish(): Promise<void>;
  adopt(settings: SharedSettings, folder: ResolvedFolder): Promise<void>;
};
const synchronizations = new Map<string, Promise<void>>();
export async function synchronizeSharedFolders(input: SyncInput): Promise<void> {
  const key=JSON.stringify([input.owner,input.installation,input.product,input.targetId]);
  const prior=synchronizations.get(key) ?? Promise.resolve();
  const next=prior.catch(()=>undefined).then(()=>applySharedFolders(input));
  synchronizations.set(key,next);
  try {await next;} finally {if(synchronizations.get(key)===next)synchronizations.delete(key);}
}
async function applySharedFolders(input: SyncInput): Promise<void> {
  await input.current();
  const desired = await input.snapshot();await input.current();
  const snapshotKey = JSON.stringify([input.owner, input.installation, input.product, input.targetId]);
  await input.update(state => {state.sharedSettings ??= {};state.sharedSettings[snapshotKey] = desired;});
  for (const settings of desired) {
    if (settings.relativeFolderPath === null || await input.pending(settings.followId)) continue;
    const key = JSON.stringify([input.owner,input.installation,input.product,input.targetId,settings.followId]);
    const current = async () => {
      await input.current();
      const row = (await input.load()).sharedSettings?.[snapshotKey]?.find(v => v.followId === settings.followId);
      return row?.pathRevision === settings.pathRevision && row.relativeFolderPath === settings.relativeFolderPath
        && !await input.pending(settings.followId);
    };
    try {
      const folder = await resolveSharedFolder(key, {path: settings.relativeFolderPath, revision: settings.pathRevision}, {
        load: async () => (await input.load()).sharedFolderAdoptions?.[key],
        persist: async value => {await input.current();await input.update(state => {
          state.sharedFolderAdoptions ??= {};state.sharedFolderAdoptions[key] = value;
        });}, current, list: () => input.folders(), create: path => input.create(path)
      });
      if (!await current()) throw new Error("The shared destination changed.");
      await input.publish();await input.current();
      await input.adopt(settings, folder);await input.current();
    } catch (error) {
      // A known removed folder must leave the original binding intact. Source preflight records its failure.
      if (!(error instanceof Error && "code" in error && error.code === "DESTINATION_PATH_INVALID")) throw error;
    }
  }
}
