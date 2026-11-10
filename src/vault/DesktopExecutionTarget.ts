import type { NativeExecutionTarget } from "../runtime/NativeExecutionTarget";

/** Resolves the physical desktop Vault locally; paths never enter the API payload. */
export async function desktopExecutionTarget(basePath: string): Promise<NativeExecutionTarget> {
  const fs = await import("node:fs/promises");
  const { constants } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const physical = await fs.realpath(basePath);
  const targetId = `obsidian-vault-${createHash("sha256").update(physical).digest("hex")}`;
  let writable = false;
  const healthy = (await fs.stat(physical)).isDirectory();
  if (healthy) {
    try { await fs.access(physical, constants.W_OK); writable = true; } catch { /* Preserve explicit non-writable status. */ }
  }
  return { targetId, healthy, writable };
}

