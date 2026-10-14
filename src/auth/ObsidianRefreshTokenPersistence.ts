import type { RefreshTokenPersistence } from "./AuthService";
import { PluginStateStore } from "../runtime/PluginStateStore";
import { SecretTokenStore } from "../runtime/SecretTokenStore";

export class ObsidianRefreshTokenPersistence implements RefreshTokenPersistence {
  constructor(
    private readonly stateStore: PluginStateStore,
    private readonly tokenStore: SecretTokenStore
  ) {}

  async load(): Promise<string | null> {
    const state = await this.stateStore.load();
    const token = this.tokenStore.getRefreshToken(state.refreshTokenSecretId);
    if (state.refreshTokenSecretId && !token) throw new Error("Obsidian could not read the saved sign-in credential.");
    return token;
  }

  async save(refreshToken: string): Promise<void> {
    const state = await this.stateStore.load();
    const secretId = this.tokenStore.setRefreshToken(state.installationId, refreshToken);
    await this.stateStore.update((current) => {
      current.refreshTokenSecretId = secretId;
    });
  }

  async clear(): Promise<void> {
    const state = await this.stateStore.load();
    this.tokenStore.clearRefreshToken(state.refreshTokenSecretId);
    await this.stateStore.update((current) => {
      delete current.refreshTokenSecretId;
    });
  }
}

