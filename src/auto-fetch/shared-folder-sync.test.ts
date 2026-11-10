import {expect,it,vi} from "vitest";
import {synchronizeSharedFolders, type SharedLocalState} from "./shared-folder-sync";
it("applies only the final snapshot and persists before adoption, then refuses a missing adopted folder", async () => {
  const state: SharedLocalState = {};
  let folders: {id: string; path: string}[] = [];
  const create = vi.fn(async (path: string) => {const folder = {id: "folder",path};folders.push(folder);return folder;});
  const adopt = vi.fn(async () => {expect(Object.values(state.sharedFolderAdoptions ?? {})[0]?.folder?.path).toBe("C");});
  const input = {owner: "owner",installation: "installation",product: "native",targetId: "target",
    snapshot: async () => [{followId: "follow", configRevision: 3, taskTimeZone: "UTC", relativeFolderPath: "C", pathRevision: 3}],
    load: async () => state, update: async (action: (s: SharedLocalState) => void) => {action(state);},
    current: async () => {}, pending: async () => false, folders: async () => folders, create,
    publish: async () => {}, adopt};
  await synchronizeSharedFolders(input);expect(create).toHaveBeenCalledExactlyOnceWith("C");expect(adopt).toHaveBeenCalledOnce();
  folders=[];await synchronizeSharedFolders(input);await synchronizeSharedFolders(input);
  expect(create).toHaveBeenCalledOnce();expect(adopt).toHaveBeenCalledOnce();
  expect(Object.values(state.sharedFolderAdoptions ?? {})[0]?.invalid).toBe(true);
});
it("does not create or adopt while a local edit is pending", async () => {
  const state: SharedLocalState = {};const create = vi.fn();const adopt = vi.fn();
  await synchronizeSharedFolders({owner:"owner",installation:"installation",product:"native",targetId:"target",
    snapshot: async () => [{followId:"follow",configRevision:1,taskTimeZone:null,relativeFolderPath:"A",pathRevision:1}],
    load: async () => state,update: async action => {action(state);},current: async () => {},pending: async () => true,
    folders: async () => [],create,publish: async () => {},adopt});
  expect(create).not.toHaveBeenCalled();expect(adopt).not.toHaveBeenCalled();
});
