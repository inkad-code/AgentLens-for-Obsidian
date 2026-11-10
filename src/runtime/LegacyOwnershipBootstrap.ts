import { AuthService, type AuthApi } from "../auth/AuthService";
import { LegacyInstallationOwnership } from "./LegacyInstallationOwnership";
import { SecretTokenStore } from "./SecretTokenStore";

type IdentityApi = AuthApi & {
  account(accessToken: string): Promise<{ installationId: string; user: { id: string } }>;
};

/** Restore only credentials already held by this host. Never write shared execution data. */
export function createLegacyOwnershipVerifier(
  secrets: SecretTokenStore,
  createApi: (installationId: string) => IdentityApi
): (legacy: unknown) => Promise<boolean> {
  const sessions = new Map<string, Promise<LegacyInstallationOwnership>>();
  return async legacy => {
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return false;
    const record = legacy as Record<string, unknown>;
    const id = record.installationId;
    if (typeof id !== "string" || !id.trim() || id.trim() !== id) return false;
    const secretId = secrets.secretId(id);
    if (record.refreshTokenSecretId !== secretId || !secrets.getRefreshToken(secretId)) return false;
    let session = sessions.get(id);
    if (!session) {
      session = (async () => {
        const api = createApi(id);
        const auth = new AuthService(api, {
          load: async () => secrets.getRefreshToken(secretId),
          save: async token => { secrets.setRefreshToken(id, token); },
          // Failed ownership verification must retain the original recovery evidence.
          clear: async () => {}
        });
        await auth.restore();
        return new LegacyInstallationOwnership(id, auth, secrets, api);
      })();
      sessions.set(id, session);
    }
    return (await session).verify(legacy);
  };
}
