import type { SecretStorage } from "obsidian";

const REVOKED_SECRET = "agentlens-revoked";

export class SecretTokenStore {
  constructor(private readonly secrets: Pick<SecretStorage, "getSecret" | "setSecret">) {}

  secretId(installationId: string): string {
    const safeId = installationId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `agentlens-refresh-${safeId}`.slice(0, 128);
  }

  setRefreshToken(installationId: string, token: string): string {
    if (!token) throw new Error("Refusing to persist an empty refresh token.");
    const id = this.secretId(installationId);
    this.secrets.setSecret(id, token);
    return id;
  }

  getRefreshToken(secretId: string | undefined): string | null {
    if (!secretId) return null;
    const secret = this.secrets.getSecret(secretId);
    return !secret || secret === REVOKED_SECRET ? null : secret;
  }

  clearRefreshToken(secretId: string | undefined): void {
    // Obsidian SecretStorage rejects blank values and does not expose deletion.
    // Overwrite the old token with an inert non-secret marker, then remove the
    // reference from plugin state in ObsidianRefreshTokenPersistence.
    if (secretId) this.secrets.setSecret(secretId, REVOKED_SECRET);
  }
}
