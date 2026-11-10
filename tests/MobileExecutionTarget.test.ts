import { expect, it, vi } from "vitest";
import { MobileExecutionTarget } from "../src/vault/MobileExecutionTarget";
function fixture() {
  const storage = new Map<string, unknown>(); const files = new Map<string, string>(); let time = 0; let n = 0;
  const host = {loadLocalStorage: (key: string) => storage.get(key), saveLocalStorage: (key: string, value: unknown) => {storage.set(key, value);}};
  const adapter = {stat: vi.fn(async () => ({type: "folder"})), exists: vi.fn(async (p: string) => files.has(p)),
    write: vi.fn(async (p: string, text: string) => {files.set(p, text);}),
    read: vi.fn(async (p: string) => {if (!files.has(p)) throw new Error("missing"); return files.get(p)!;}),
    remove: vi.fn(async (p: string) => {files.delete(p);})};
  const random = () => `00000000-0000-4000-8000-${String(++n).padStart(12,"0")}`;
  const resolve = () => new MobileExecutionTarget(host, adapter, ".obsidian/plugins/agentlens", random, () => time);
  return {host, storage, files, adapter, resolve, advance: () => {time += 30_001;}};
}
it("persists opaque identity in Vault-local storage and verifies writes without retaining probe files", async () => {
  const f = fixture(); const target = f.resolve(); const first = await target.resolve();
  expect(first).toMatchObject({healthy: true, writable: true}); expect(first.targetId).toMatch(/^obsidian-vault-local-/);
  expect((await f.resolve().resolve()).targetId).toBe(first.targetId); expect(f.files.size).toBe(0);
  const calls = f.adapter.write.mock.calls.length; await target.resolve(); expect(f.adapter.write).toHaveBeenCalledTimes(calls);
  f.advance(); await target.resolve(); expect(f.adapter.write).toHaveBeenCalledTimes(calls + 1);
});
it("never replaces corrupt identity or accepts a failed identity persistence", async () => {
  const f = fixture(); f.storage.set("agentlens-mobile-execution-target-v1", "corrupt");
  await expect(f.resolve().resolve()).rejects.toThrow("identity"); expect(f.adapter.write).not.toHaveBeenCalled();
  f.storage.clear(); f.host.saveLocalStorage = () => {};
  await expect(f.resolve().resolve()).rejects.toThrow("identity"); expect(f.adapter.write).not.toHaveBeenCalled();
});
it("does not claim writable or accumulate probes when cleanup fails", async () => {
  const f = fixture(); f.adapter.remove.mockRejectedValue(new Error("denied")); const target = f.resolve();
  expect((await target.resolve()).writable).toBe(false); expect(f.files.size).toBe(1);
  f.advance(); expect((await target.resolve()).writable).toBe(false); expect(f.adapter.write).toHaveBeenCalledOnce();
  f.adapter.remove.mockImplementation(async p => {f.files.delete(p);}); f.advance();
  expect((await target.resolve()).writable).toBe(true); expect(f.files.size).toBe(0);
});
it("rejects identity rotation while probing and shares concurrent checks", async () => {
  const f = fixture(); const target = f.resolve();
  f.adapter.write.mockImplementationOnce(async (p, text) => { f.files.set(p,text); f.storage.set("agentlens-mobile-execution-target-v1", "00000000-0000-4000-8000-999999999999"); });
  const results = await Promise.allSettled([target.resolve(), target.resolve()]);
  expect(results.every(r => r.status === "rejected")).toBe(true); expect(f.adapter.write).toHaveBeenCalledOnce();
});
it("does not overwrite a pre-existing probe path", async () => {
  const f = fixture(); const path = ".obsidian/plugins/agentlens/.agentlens-write-probe-00000000-0000-4000-8000-000000000002.tmp";
  f.files.set(path, "existing"); expect((await f.resolve().resolve()).writable).toBe(false);
  expect(f.adapter.write).not.toHaveBeenCalled(); expect(f.files.get(path)).toBe("existing");
});
it("keeps cleanup pending when remove silently leaves the file behind", async () => {
  const f = fixture(); f.adapter.remove.mockImplementation(async () => {}); const target = f.resolve();
  expect((await target.resolve()).writable).toBe(false); f.advance();
  expect((await target.resolve()).writable).toBe(false); expect(f.adapter.write).toHaveBeenCalledOnce();
});
it("recovers a prior process probe before writing another and retains mismatched content", async () => {
  const f = fixture(); f.adapter.remove.mockRejectedValue(new Error("suspended"));
  expect((await f.resolve().resolve()).writable).toBe(false);
  expect(f.storage.get("agentlens-mobile-execution-target-v1-probe")).toMatchObject({version: 1});
  const old = [...f.files.keys()][0]!;
  f.files.set(old, "different content"); f.adapter.remove.mockImplementation(async p => {f.files.delete(p);});
  expect((await f.resolve().resolve()).writable).toBe(false); expect(f.files.get(old)).toBe("different content");
  expect(f.adapter.write).toHaveBeenCalledOnce();
  const journal = f.storage.get("agentlens-mobile-execution-target-v1-probe") as {nonce: string};
  f.files.set(old, `agentlens-probe:${journal.nonce}`);
  expect((await f.resolve().resolve()).writable).toBe(true);
  expect(f.files.size).toBe(0); expect(f.storage.get("agentlens-mobile-execution-target-v1-probe")).toBeNull();
});
it("does not write when durable probe reservation cannot be saved", async () => {
  const f = fixture(); const save = f.host.saveLocalStorage;
  f.host.saveLocalStorage = (key, value) => {if (key.endsWith("-probe")) throw new Error("disk"); save(key, value);};
  expect((await f.resolve().resolve()).writable).toBe(false); expect(f.adapter.write).not.toHaveBeenCalled();
});
it("clears a pre-write crash journal without deleting unrelated files", async () => {
  const f = fixture(); const first = await f.resolve().resolve();
  f.storage.set("agentlens-mobile-execution-target-v1-probe", {version: 1, targetId: first.targetId, directory: ".obsidian/plugins/agentlens", nonce: "00000000-0000-4000-8000-999999999999"});
  f.files.set("notes/keep.md", "important");
  expect((await f.resolve().resolve()).writable).toBe(true); expect(f.files.get("notes/keep.md")).toBe("important");
});
it("preserves malformed or foreign cleanup journals without creating another probe", async () => {
  const f = fixture(); await f.resolve().resolve(); const writes = f.adapter.write.mock.calls.length;
  for (const record of ["corrupt", {version: 1, targetId: "foreign", directory: ".obsidian/plugins/agentlens", nonce: "00000000-0000-4000-8000-999999999999"}]) {
    f.storage.set("agentlens-mobile-execution-target-v1-probe", record);
    expect((await f.resolve().resolve()).writable).toBe(false);
    expect(f.storage.get("agentlens-mobile-execution-target-v1-probe")).toEqual(record);
  }
  expect(f.adapter.write).toHaveBeenCalledTimes(writes);
});
it("serializes separate resolver instances so one cannot clean another active probe", async () => {
  const f = fixture(); let unblock!: () => void; let entered!: () => void;
  const blocked = new Promise<void>(resolve => {unblock = resolve;});
  const started = new Promise<void>(resolve => {entered = resolve;});
  f.adapter.write.mockImplementationOnce(async (path, text) => {f.files.set(path, text); entered(); await blocked;});
  const first = f.resolve().resolve(); await started;
  const second = f.resolve().resolve(); await Promise.resolve();
  expect(f.adapter.write).toHaveBeenCalledOnce(); expect(f.adapter.remove).not.toHaveBeenCalled();
  unblock();
  const results = await Promise.all([first, second]);
  expect(results.every(v => v.writable)).toBe(true); expect(f.files.size).toBe(0);
});
it("does not claim success when cleanup journal removal is not durably acknowledged", async () => {
  const f = fixture(); const save = f.host.saveLocalStorage;
  f.host.saveLocalStorage = (key, value) => {if (key.endsWith("-probe") && value === null) return; save(key, value);};
  expect((await f.resolve().resolve()).writable).toBe(false); expect(f.files.size).toBe(0);
  expect(f.storage.get("agentlens-mobile-execution-target-v1-probe")).not.toBeNull();
  f.host.saveLocalStorage = save;
  expect((await f.resolve().resolve()).writable).toBe(true);
});
