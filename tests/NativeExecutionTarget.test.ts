import { expect, it } from "vitest";
import { mkdtemp, mkdir, symlink, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireMatchingExecutionTarget } from "../src/runtime/NativeExecutionTarget";
import { desktopExecutionTarget } from "../src/vault/DesktopExecutionTarget";
it("uses an opaque physical Vault identity across aliases without creating probe files", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlens-target-test-"));
  try {
    const vault = join(root, "vault"), other = join(root, "other"), alias = join(root, "alias");
    await mkdir(vault); await mkdir(other); await symlink(vault, alias);
    const first = await desktopExecutionTarget(vault);
    expect(first).toMatchObject({ healthy: true, writable: true });
    expect(first.targetId).toMatch(/^obsidian-vault-[a-f0-9]{64}$/);
    expect((await desktopExecutionTarget(alias)).targetId).toBe(first.targetId);
    expect((await desktopExecutionTarget(other)).targetId).not.toBe(first.targetId);
    expect(await readdir(vault)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("requires positive identity for target-bound work and retains legacy identity semantics", () => {
  expect(() => requireMatchingExecutionTarget("a", "a")).not.toThrow();
  expect(() => requireMatchingExecutionTarget("a", "b")).toThrow("original Vault");
  expect(() => requireMatchingExecutionTarget("a", undefined)).toThrow("original Vault");
  expect(() => requireMatchingExecutionTarget(undefined, "a")).not.toThrow();
});
