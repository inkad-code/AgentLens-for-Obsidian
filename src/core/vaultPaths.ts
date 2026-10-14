import { AgentLensError } from "./errors";

export function normalizeVaultRelativePath(input: string): string {
  const value = input.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!value || value.startsWith("/") || /^[a-zA-Z]:\//.test(value)) {
    throw new AgentLensError("vault_conflict", "Vault folder must be a non-empty relative path.", false);
  }
  const segments = value.split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new AgentLensError("vault_conflict", "Vault folder cannot escape the vault.", false);
  }
  return segments.join("/");
}
