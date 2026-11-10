import type { AuthService } from "../auth/AuthService";
import type { SecretTokenStore } from "./SecretTokenStore";

interface AccountIdentityReader {
  account(accessToken: string): Promise<{ installationId: string; user: { id: string } }>;
}

/** Uses an already restored session: migration must not independently rotate refresh tokens. */
export class LegacyInstallationOwnership {
  constructor(private readonly installationId: string,
    private readonly auth: Pick<AuthService, "snapshot" | "sessionEpoch">,
    private readonly secrets: Pick<SecretTokenStore, "secretId" | "getRefreshToken">,
    private readonly api: AccountIdentityReader,
    private readonly now: () => number = Date.now) {}

  async verify(legacy: unknown): Promise<boolean> {
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return false;
    const record = legacy as Record<string, unknown>;
    const secretId = this.secrets.secretId(this.installationId);
    if (record.installationId !== this.installationId || record.refreshTokenSecretId !== secretId) return false;
    const credential = this.secrets.getRefreshToken(secretId);
    if (!credential) return false;
    const epoch = this.auth.sessionEpoch();
    const session = this.auth.snapshot();
    if (session.status !== "signed_in" || session.accessTokenExpiresAt <= this.now()) return false;
    const account = await this.api.account(session.accessToken);
    const current = this.auth.snapshot();
    return account.installationId === this.installationId && !!account.user.id
      && this.auth.sessionEpoch() === epoch && current.status === "signed_in"
      && current.accessToken === session.accessToken && current.accessTokenExpiresAt > this.now()
      && this.secrets.getRefreshToken(secretId) === credential;
  }
}
