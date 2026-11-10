import {synchronizeSharedFolders} from "../auto-fetch/shared-folder-sync";
import { AgentLensError } from "../core/errors";
import { recordDiagnostic } from "../diagnostics/log";
import type { AgentLensApiPort } from "../workbench/ports";
import type { PluginStateStore } from "./PluginStateStore";
import type { NativeExecutionTarget } from "./NativeExecutionTarget";
import { matchesDestination } from "../api/nativeDestinations";

export async function syncDestinations(api: AgentLensApiPort, store: PluginStateStore, owner: string, token: string,
  resolve: () => Promise<NativeExecutionTarget | undefined>, current: () => Promise<boolean>): Promise<void> {
  if (!api.registerDestination || !api.pendingDestinations || !api.adoptDestination) return;
  const target = await resolve();
  if (!target?.folders || !target.name) return;
  const initial = await store.load();
  const check = async () => {
    if (!await current() || (await store.load()).installationId !== initial.installationId || (await resolve())?.targetId !== target.targetId)
      throw new Error("Destination account or Vault changed.");
  };
  await check();
  try {
    await api.registerDestination(token, {targetId: target.targetId, name: target.name, folders: target.folders, writable: target.healthy && target.writable});
  } catch (error) {
    // Catalog publication is not configuration synchronization. Do not adopt a
    // remote destination without a fresh catalog, but allow native setup/sync.
    await check();
    if (error instanceof AgentLensError && (error.status === 401 || error.status === 403
      || error.code === "auth_required" || error.code === "forbidden")) throw error;
    recordDiagnostic("destination.catalog_deferred", {userId: owner, installationId: initial.installationId}, {
      reason: "registration_failed", httpStatus: error instanceof AgentLensError ? error.status : undefined,
      requestId: error instanceof AgentLensError ? error.requestId : undefined
    });
    return; // The next setup/scheduler pass retries; no adoption evidence changes.
  }
  await check();
  if (api.sharedSettings && api.adoptSharedFolder && target.createFolder && target.writable && target.healthy) {
    await synchronizeSharedFolders({owner, installation: initial.installationId, product: "obsidian", targetId: target.targetId,
      snapshot: () => api.sharedSettings!(token), load: () => store.load(), current: check,
      update: async action => {await store.update(state => {action(state);});},
      pending: async followId => ((await store.load()).followConfigurationOutbox ?? []).some(v => v.owner === owner && v.installationId === initial.installationId && v.followId === followId && !v.resolution),
      folders: async () => (await resolve())?.folders ?? [], create: target.createFolder,
      publish: async () => {const fresh = await resolve();await check();if (!fresh?.folders) throw new Error("The Vault changed.");await api.registerDestination!(token, {targetId: fresh.targetId, name: fresh.name!, folders: fresh.folders, writable: fresh.writable && fresh.healthy});},
      adopt: async (row, folder) => {await api.adoptSharedFolder!(token, {followId: row.followId, targetId: target.targetId, pathRevision: row.pathRevision, folderId: folder.id});}
    });
  }
  const pending = await api.pendingDestinations(token, target.targetId);
  await check();
  if (!pending.length || !target.healthy || !target.writable) return;
  const creators = await api.listCreators(token);
  await check();
  const valid = pending.filter(row => row.installationId === initial.installationId && row.targetId === target.targetId
    && target.folders!.some(f => f.id === row.saveFolderId && f.path === row.saveFolderPath)
    && (row.recordType === "configuration" || creators.some(creator => matchesDestination(row, {...creator, saveFolderId: `vault:${creator.saveFolderPath}`}))));
  await store.update(state => {
    if (state.installationId !== initial.installationId) throw new Error("Destination installation changed.");
    state.destinationConfigurations ??= {};
    state.destinationConfigurations[JSON.stringify([owner, initial.installationId, target.targetId])] = valid;
  });
  for (const binding of valid) {
    await check(); const fresh = await resolve();
    if (!fresh?.writable || !fresh.healthy || !fresh.folders?.some(folder => folder.id === binding.saveFolderId && folder.path === binding.saveFolderPath)) continue;
    await check(); await api.adoptDestination(token, binding);
  }
}
