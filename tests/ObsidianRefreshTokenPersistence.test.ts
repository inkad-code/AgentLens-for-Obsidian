import { describe, expect, it, vi } from "vitest";
import { ObsidianRefreshTokenPersistence } from "@/auth/ObsidianRefreshTokenPersistence";
import { AuthService } from "@/auth/AuthService";
import { PluginStateStore, type PluginDataAdapter } from "@/runtime/PluginStateStore";
import { SecretTokenStore } from "@/runtime/SecretTokenStore";

describe("ObsidianRefreshTokenPersistence", () => {
  it("keeps token material out of plugin data", async () => {
    let data: unknown = {};
    const adapter: PluginDataAdapter = {
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    };
    const secrets = new Map<string, string>();
    const persistence = new ObsidianRefreshTokenPersistence(
      new PluginStateStore(adapter, () => "install-1"),
      new SecretTokenStore({
        getSecret: (id) => secrets.get(id) ?? null,
        setSecret: (id, value) => { secrets.set(id, value); }
      })
    );

    await persistence.save("refresh-secret");
    expect(JSON.stringify(data)).not.toContain("refresh-secret");
    await expect(persistence.load()).resolves.toBe("refresh-secret");
    await persistence.clear();
    await expect(persistence.load()).resolves.toBeNull();
  });

  it("reports a missing host secret without erasing the reference or dispatching refresh", async () => {
    let data: unknown = {};
    const adapter: PluginDataAdapter = { loadData: async () => structuredClone(data), saveData: async value => { data = structuredClone(value); } };
    const secrets = new Map<string, string>();
    const state = new PluginStateStore(adapter, () => "install-1");
    const persistence = new ObsidianRefreshTokenPersistence(state, new SecretTokenStore({
      getSecret: id => secrets.get(id) ?? null, setSecret: (id, value) => { secrets.set(id, value); }
    }));
    await persistence.save("refresh-secret");
    const before = structuredClone(data);
    secrets.clear();
    const refresh = vi.fn(async () => ({ accessToken: "restored", expiresIn: 3600 }));
    const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh, revoke: vi.fn() }, persistence, () => 0);
    expect(await auth.restore()).toEqual({ status: "error", reason: "credential_unavailable" });
    expect(refresh).not.toHaveBeenCalled();
    expect(data).toEqual(before);
    expect(JSON.stringify(data)).not.toContain("refresh-secret");
    secrets.set("agentlens-refresh-install-1", "refresh-secret");
    expect(await auth.restore()).toMatchObject({ status: "signed_in", accessToken: "restored" });
    expect(refresh).toHaveBeenCalledExactlyOnceWith("refresh-secret");
  });

  it("restores a newly authorized session after a tombstone and plugin reload", async () => {
    let data: unknown = {};
    const adapter: PluginDataAdapter = {
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    };
    const secrets = new Map<string, string>();
    const tokenStore = () => new SecretTokenStore({
      getSecret: (id) => secrets.get(id) ?? null,
      setSecret: (id, value) => {
        if (!value) throw new Error("must not be blank");
        secrets.set(id, value);
      }
    });
    const first = new ObsidianRefreshTokenPersistence(
      new PluginStateStore(adapter, () => "install-1"),
      tokenStore()
    );

    await first.save("old-refresh");
    await first.clear();
    expect(secrets.get("agentlens-refresh-install-1")).toBe("agentlens-revoked");
    await first.save("new-refresh");
    expect(JSON.stringify(data)).not.toMatch(/old-refresh|new-refresh|agentlens-revoked/);

    const afterReload = new ObsidianRefreshTokenPersistence(
      new PluginStateStore(adapter, () => "unexpected-new-installation"),
      tokenStore()
    );
    const refresh = vi.fn(async (token: string) => {
      expect(token).toBe("new-refresh");
      return { accessToken: "restored-access", expiresIn: 3600 };
    });
    const revoke = vi.fn(async (token: string) => {
      expect(token).toBe("new-refresh");
    });
    const auth = new AuthService({
      startDeviceAuthorization: vi.fn(),
      pollDeviceAuthorization: vi.fn(),
      refresh,
      revoke
    }, afterReload, () => 1_000);

    await expect(auth.restore()).resolves.toEqual({
      status: "signed_in",
      accessToken: "restored-access",
      accessTokenExpiresAt: 3_601_000,
      clientType: "obsidian_plugin"
    });
    expect(refresh).toHaveBeenCalledExactlyOnceWith("new-refresh");
    expect((await new PluginStateStore(adapter).load()).installationId).toBe("install-1");

    await auth.signOut();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("new-refresh");
    expect(secrets.get("agentlens-refresh-install-1")).toBe("agentlens-revoked");
    expect(JSON.stringify(data)).not.toContain("refreshTokenSecretId");

    const signedOutAfterReload = new AuthService({
      startDeviceAuthorization: vi.fn(),
      pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(),
      revoke: vi.fn()
    }, new ObsidianRefreshTokenPersistence(
      new PluginStateStore(adapter, () => "another-unexpected-installation"),
      tokenStore()
    ));
    await expect(signedOutAfterReload.restore()).resolves.toEqual({ status: "signed_out" });
  });
});
