import { describe, it, expect, vi } from "vitest";
import { resolveSharedFolder, validateRelativeFolder, type FolderAdoption, type ResolvedFolder } from "./shared-folder";
function fixture() {
  let saved: FolderAdoption | undefined;
  let folders: ResolvedFolder[] = [];
  const port = {load: async () => saved, persist: async (v: FolderAdoption) => { saved = structuredClone(v); },
    list: async () => folders, current: async () => true,
    create: vi.fn(async (path: string) => { const folder = {id: "id-" + (folders.length + 1), path}; folders.push(folder); return folder; })};
  return {port, get saved() { return saved; }, set folders(v: ResolvedFolder[]) { folders = v; }};
}
describe("shared directory authorization", () => {
  it("creates once, refuses deleted adopted folders and only reapplication permits recreation", async () => {
    const f = fixture(); const desired = {path: "Creators/Alice", revision: 1};
    await Promise.all([resolveSharedFolder("a", desired, f.port), resolveSharedFolder("a", desired, f.port)]);
    expect(f.port.create).toHaveBeenCalledTimes(1); expect(f.saved?.folder?.id).toBe("id-1");
    f.folders = [];
    await expect(resolveSharedFolder("a", desired, f.port)).rejects.toMatchObject({code: "DESTINATION_PATH_INVALID"});
    expect(f.port.create).toHaveBeenCalledTimes(1);
    await resolveSharedFolder("a", {...desired, revision: 2}, f.port);
    expect(f.port.create).toHaveBeenCalledTimes(2);
  });
  it("adopts an existing unique folder without creating and rejects same-name replacements", async () => {
    const f = fixture();f.folders = [{id: "original", path: "A"}];
    await resolveSharedFolder("b", {path: "A", revision: 1}, f.port);
    f.folders = [{id: "replacement", path: "A"}];
    await expect(resolveSharedFolder("b", {path: "A", revision: 1}, f.port)).rejects.toMatchObject({code: "DESTINATION_PATH_INVALID"});
    expect(f.port.create).not.toHaveBeenCalled();
  });
  it("stops changed identities before creating and never creates ambiguous folders", async () => {
    const f = fixture();f.port.current = async () => false;
    await expect(resolveSharedFolder("c", {path: "A", revision: 1}, f.port)).rejects.toThrow("changed");
    expect(f.port.create).not.toHaveBeenCalled();
    f.port.current = async () => true;f.folders = [{id: "one", path: "A"}, {id: "two", path: "A"}];
    await expect(resolveSharedFolder("c", {path: "A", revision: 1}, f.port)).rejects.toThrow("ambiguous");
  });
  it("persists before creation, and rejects stale configuration and unsafe paths", async () => {
    const f = fixture();f.port.persist = async () => { throw new Error("disk full"); };
    await expect(resolveSharedFolder("d", {path: "A", revision: 1}, f.port)).rejects.toThrow("disk full");
    expect(f.port.create).not.toHaveBeenCalled();
    for (const path of ["../A", "/A", "a//b", "C:/A", "a/../b", "a\\b", "a\u0000b"]) expect(() => validateRelativeFolder(path)).toThrow();
    expect(() => validateRelativeFolder("")).not.toThrow();
    expect(() => validateRelativeFolder("研究/Alice")).not.toThrow();
  });
});
