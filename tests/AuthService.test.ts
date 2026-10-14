import { describe, expect, it, vi } from "vitest";
import { AuthService, type AuthApi, type RefreshTokenPersistence } from "@/auth/AuthService";
import { AgentLensError } from "@/core/errors";

function persistence(initial: string | null = null): RefreshTokenPersistence & { value: string | null } {
  return {
    value: initial,
    async load() { return this.value; },
    async save(value) { this.value = value; },
    async clear() { this.value = null; }
  };
}

function api(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    startDeviceAuthorization: vi.fn(async () => ({
      deviceCode: "device-secret",
      userCode: "ABCD-EFGH",
      verificationUri: "https://agentlens.example/device",
      googleAuthorizationUrl: "https://agentlens.example/api/auth/oauth/google/start?pluginTicket=signed-ticket",
      expiresIn: 600,
      interval: 5
    })),
    pollDeviceAuthorization: vi.fn(async (_deviceCode: string) => ({ status: "authorization_pending" as const })),
    refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })),
    revoke: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("AuthService", () => {
  it("retains Google intent when the login expires so restart follows the same flow", async () => {
    let now = 0;
    const service = new AuthService(api(), persistence(), () => now);
    await service.start("google"); now = 600_001;
    expect(await service.pollOnce()).toMatchObject({status: "error", reason: "expired", provider: "google"});
  });

  it("reschedules a transient polling failure without replacing the device code", async () => {
    let now = 0;
    const poll = vi.fn().mockRejectedValueOnce(new AgentLensError("network_unavailable", "offline", true))
      .mockResolvedValueOnce({status: "authorized", accessToken: "access", refreshToken: "refresh", expiresIn: 3600});
    const authApi = api({pollDeviceAuthorization: poll});
    const service = new AuthService(authApi, persistence(), () => now);
    await service.start("google");
    now = 5000;
    await expect(service.pollOnce()).rejects.toThrow("offline");
    expect(service.snapshot()).toMatchObject({status: "authorizing", nextPollAt: 10000, provider: "google"});
    now = 10000;
    expect((await service.pollOnce()).status).toBe("signed_in");
    expect(authApi.startDeviceAuthorization).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenLastCalledWith("device-secret");
  });

  it("ends an invalid server device code instead of endlessly polling it", async () => {
    let now = 0;
    const service = new AuthService(api({pollDeviceAuthorization: vi.fn().mockRejectedValue(
      new AgentLensError("unknown", "expired", false, 400))}), persistence(), () => now);
    await service.start(); now = 5000;
    expect(await service.pollOnce()).toEqual({status: "error", reason: "expired"});
  });

  it("binds Google intent to this device without changing its polling secret", async () => {
    const service = new AuthService(api(), persistence());
    const state = await service.start("google");
    expect(state.status).toBe("authorizing");
    if (state.status !== "authorizing") throw new Error("missing authorization");
    const url = new URL(state.authorization.verificationUriComplete!);
    expect(url.pathname).toBe("/api/auth/oauth/google/start");
    expect(url.searchParams.get("pluginTicket")).toBe("signed-ticket");
    expect(url.searchParams.has("code")).toBe(false);
    expect(url.toString()).not.toContain("device-secret");
  });

  it("uses the same direct Google flow for registration", async () => {
    const service = new AuthService(api({ startDeviceAuthorization: vi.fn(async () => ({
      deviceCode: "device-secret", userCode: "ABCD-EFGH",
      verificationUri: "https://agentlens.example/device",
      googleAuthorizationUrl: "https://agentlens.example/api/auth/oauth/google/start?pluginTicket=signed-ticket",
      verificationUriComplete: "https://agentlens.example/device?code=ABCD-EFGH&utm_source=old&keep=one",
      expiresIn: 600, interval: 5
    })) }), persistence());
    const state = await service.start("google", "sign_up");
    if (state.status !== "authorizing") throw new Error("missing authorization");
    const url = new URL(state.authorization.verificationUriComplete!);
    expect(url.pathname).toBe("/api/auth/oauth/google/start");
    expect(url.searchParams.get("pluginTicket")).toBe("signed-ticket");
    expect(url.searchParams.has("code")).toBe(false);
    expect(url.toString()).not.toContain("device-secret");
  });

  it("does not fall back to the manual device page on an older backend", async () => {
    const authApi = api();
    const start = authApi.startDeviceAuthorization;
    authApi.startDeviceAuthorization = async () => ({...await start(), googleAuthorizationUrl: undefined});
    await expect(new AuthService(authApi, persistence()).start("google")).rejects.toThrow("temporarily unavailable");
  });

  it("rejects a Google start URL on a different origin", async () => {
    const authApi = api();
    const start = authApi.startDeviceAuthorization;
    authApi.startDeviceAuthorization = async () => ({...await start(), googleAuthorizationUrl: "https://other.example/api/auth/oauth/google/start?pluginTicket=t"});
    await expect(new AuthService(authApi, persistence()).start("google")).rejects.toThrow("Invalid Google");
  });

  it("retains the Obsidian platform marker after Google device approval", async () => {
    let now = 0;
    const service = new AuthService(api({
      pollDeviceAuthorization: vi.fn(async () => ({
        status: "authorized" as const,
        accessToken: "plugin-access",
        refreshToken: "plugin-refresh",
        expiresIn: 3600
      }))
    }), persistence(), () => now);

    const started = await service.start("google");
    expect(started).toMatchObject({ status: "authorizing", clientType: "obsidian_plugin" });
    now = 5_000;
    await service.pollOnce();
    expect(service.snapshot()).toMatchObject({ status: "signed_in", clientType: "obsidian_plugin" });
  });

  it("requires a fresh challenge for configured signup and cancels without creating an account", async () => {
    const authApi = api({registrationRequirements: vi.fn(async () => ({humanVerificationRequired:true})), authenticateEmail:vi.fn(async()=>"web"), approveDevice:vi.fn(async()=>{})});
    const verifyHuman = vi.fn((signal:AbortSignal) => new Promise<string>((_,reject)=>signal.addEventListener("abort",()=>reject(new Error("cancelled")))));
    const service = new AuthService(authApi,persistence(),Date.now,verifyHuman);
    const pending=service.startWithEmail({email:"new@example.com",password:"Example123!",name:"New"});
    const rejected=expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(()=>expect(verifyHuman).toHaveBeenCalledTimes(1));
    await service.signOut();await rejected;
    expect(authApi.authenticateEmail).not.toHaveBeenCalled();
  });

  it("passes a verified challenge to signup while persisting only scoped credentials", async () => {
    const authApi=api({registrationRequirements:vi.fn(async()=>({humanVerificationRequired:true})), authenticateEmail:vi.fn(async()=>"web"),approveDevice:vi.fn(async()=>{})});
    const tokens=persistence();const verifyHuman=vi.fn(async()=>"fresh-challenge");
    const service=new AuthService(authApi,tokens,Date.now,verifyHuman);
    await service.startWithEmail({email:"new@example.com",password:"Example123!",name:"New"});
    expect(authApi.authenticateEmail).toHaveBeenCalledWith({email:"new@example.com",password:"Example123!",name:"New",turnstileToken:"fresh-challenge"});
    expect(authApi.approveDevice).toHaveBeenCalledWith("web","ABCD-EFGH");
    expect(tokens.value).toBeNull();
  });

  it("uses a transient web token to approve the current device and persists only the plugin refresh token", async () => {
    let now=0;
    const tokens=persistence();
    const authApi=api({authenticateEmail:vi.fn(async()=>"web-token"),approveDevice:vi.fn(async()=>undefined),pollDeviceAuthorization:vi.fn(async()=>({status:"authorized" as const,accessToken:"plugin-access",refreshToken:"plugin-refresh",expiresIn:3600}))});
    const service=new AuthService(authApi,tokens,()=>now);
    expect((await service.startWithEmail({email:"user@example.com",password:"test-password"})).status).toBe("authorizing");
    expect(authApi.approveDevice).toHaveBeenCalledWith("web-token","ABCD-EFGH");
    expect(tokens.value).toBeNull();
    expect((await service.pollOnce()).status).toBe("signed_in");
    expect(authApi.pollDeviceAuthorization).toHaveBeenCalledTimes(1);
    expect(tokens.value).toBe("plugin-refresh");
  });

  it("does not approve a device after email sign-in has been cancelled", async()=>{
    let resolve!: (token:string)=>void;
    const authApi=api({authenticateEmail:vi.fn(()=>new Promise<string>(done=>{resolve=done;})),approveDevice:vi.fn(async()=>undefined)});
    const tokens=persistence();const service=new AuthService(authApi,tokens);
    const pending=service.startWithEmail({email:"user@example.com",password:"test-password"});
    await vi.waitFor(()=>expect(authApi.authenticateEmail).toHaveBeenCalled());
    const logout=service.signOut();resolve("late-web-token");await Promise.all([pending,logout]);
    expect(authApi.startDeviceAuthorization).not.toHaveBeenCalled();expect(authApi.approveDevice).not.toHaveBeenCalled();
    expect(service.snapshot().status).toBe("signed_out");expect(tokens.value).toBeNull();
  });

  it("keeps failed email authentication out of the plugin token store", async()=>{
    const authApi=api({authenticateEmail:vi.fn(async()=>{throw new Error("Invalid credentials");}),approveDevice:vi.fn(async()=>undefined)});
    const tokens=persistence();const service=new AuthService(authApi,tokens);
    await expect(service.startWithEmail({email:"user@example.com",password:"wrong"})).rejects.toThrow("Invalid credentials");
    expect(authApi.startDeviceAuthorization).not.toHaveBeenCalled();expect(tokens.value).toBeNull();
  });

  it("models Device Code pending, slow-down and authorized states", async () => {
    let now = 1_000;
    const tokens = persistence();
    const poll = vi.fn()
      .mockResolvedValueOnce({ status: "slow_down", interval: 10 })
      .mockResolvedValueOnce({ status: "authorized", accessToken: "access-1", expiresIn: 3600, refreshToken: "refresh-1" });
    const service = new AuthService(api({ pollDeviceAuthorization: poll }), tokens, () => now);

    expect((await service.start()).status).toBe("authorizing");
    now = 6_000;
    expect((await service.pollOnce()).status).toBe("authorizing");
    now = 16_000;
    expect((await service.pollOnce()).status).toBe("signed_in");
    expect(tokens.value).toBe("refresh-1");
  });

  it("stops polling after the provider denies authorization", async () => {
    let now = 1_000;
    const poll = vi.fn(async () => ({ status: "denied" as const }));
    const service = new AuthService(api({ pollDeviceAuthorization: poll }), persistence(), () => now);

    await service.start();
    now = 6_000;
    expect(await service.pollOnce()).toEqual({ status: "error", reason: "denied" });
    expect(await service.pollOnce()).toEqual({ status: "error", reason: "denied" });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("expires a local device code without sending another poll", async () => {
    let now = 1_000;
    const poll = vi.fn(async () => ({ status: "authorization_pending" as const }));
    const service = new AuthService(api({
      startDeviceAuthorization: vi.fn(async () => ({
        deviceCode: "device-secret",
        userCode: "ABCD-EFGH",
        verificationUri: "https://agentlens.example/device",
      googleAuthorizationUrl: "https://agentlens.example/api/auth/oauth/google/start?pluginTicket=signed-ticket",
        expiresIn: 1,
        interval: 1
      })),
      pollDeviceAuthorization: poll
    }), persistence(), () => now);

    await service.start();
    now = 2_000;
    expect(await service.pollOnce()).toEqual({ status: "error", reason: "expired" });
    expect(poll).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent refresh and keeps access tokens in memory", async () => {
    const tokens = persistence("refresh-1");
    let release!: () => void;
    const refresh = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { accessToken: "access-1", expiresIn: 3600 };
    });
    const service = new AuthService(api({ refresh }), tokens, () => 1_000);

    const first = service.accessToken();
    const second = service.accessToken();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(["access-1", "access-1"]);
  });

  it("clears local credentials even when remote revoke fails", async () => {
    const tokens = persistence("refresh-1");
    const service = new AuthService(api({ revoke: vi.fn(async () => { throw new Error("offline"); }) }), tokens);

    await expect(service.signOut()).rejects.toThrow("offline");
    expect(tokens.value).toBeNull();
    expect(service.snapshot().status).toBe("signed_out");
  });

  it("fails closed after an invalid stored refresh token", async () => {
    const tokens = persistence("invalid-refresh");
    const service = new AuthService(api({
      refresh: vi.fn(async () => { throw new AgentLensError("auth_required", "invalid grant", false, 401); })
    }), tokens);

    expect(await service.restore()).toEqual({ status: "error", reason: "refresh_failed" });
    expect(tokens.value).toBeNull();
  });

  it("keeps a saved refresh token across a retryable restore outage", async () => {
    const tokens = persistence("refresh-1");
    const refresh = vi.fn()
      .mockRejectedValueOnce(new AgentLensError("network_unavailable", "offline", true))
      .mockResolvedValueOnce({ accessToken: "access-1", expiresIn: 3600 });
    const service = new AuthService(api({ refresh }), tokens, () => 1_000);

    expect(await service.restore()).toEqual({ status: "error", reason: "refresh_unavailable" });
    expect(tokens.value).toBe("refresh-1");
    expect(await service.restore()).toEqual({
      status: "signed_in",
      accessToken: "access-1",
      accessTokenExpiresAt: 3_601_000,
      clientType: "obsidian_plugin"
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("shares refresh rotation between restore and background access", async () => {
    const tokens = persistence("refresh-old");
    const refresh = vi.fn(async () => ({ accessToken: "access-new", expiresIn: 3600, refreshToken: "refresh-new" }));
    const service = new AuthService(api({ refresh }), tokens);
    await Promise.all([service.restore(), service.accessToken(), service.restore()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(tokens.value).toBe("refresh-new");
    await service.restore();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("revokes the rotated credential when logout overtakes a refresh", async () => {
    const tokens = persistence("refresh-old");
    let release!: () => void;
    const refresh = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { accessToken: "late-access", expiresIn: 3600, refreshToken: "rotated-refresh" };
    });
    const revoke = vi.fn(async () => undefined);
    const service = new AuthService(api({ refresh, revoke }), tokens);
    const refreshing = service.accessToken();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const logout = service.signOut();
    release();
    await Promise.all([refreshing, logout]);
    expect(revoke).toHaveBeenCalledWith("rotated-refresh");
    expect(service.snapshot().status).toBe("signed_out");
    expect(tokens.value).toBeNull();
  });

  it("cancels an in-flight device approval without resurrecting a session", async () => {
    let now = 0;
    let release!: () => void;
    const tokens = persistence();
    const poll = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { status: "authorized" as const, accessToken: "late-access", expiresIn: 3600, refreshToken: "late-refresh" };
    });
    const revoke = vi.fn(async () => undefined);
    const service = new AuthService(api({ pollDeviceAuthorization: poll, revoke }), tokens, () => now);
    await service.start();
    now = 5_000;
    const polling = service.pollOnce();
    await vi.waitFor(() => expect(poll).toHaveBeenCalledTimes(1));
    const logout = service.signOut();
    release();
    await Promise.all([polling, logout]);
    expect(service.snapshot().status).toBe("signed_out");
    expect(tokens.value).toBeNull();
    expect(revoke).toHaveBeenCalledWith("late-refresh");
  });

  it("does not restore an authorizing session or send parallel device polls", async () => {
    let now = 0;
    const tokens = persistence();
    const poll = vi.fn(async () => ({ status: "authorized" as const, accessToken: "access", expiresIn: 3600, refreshToken: "refresh" }));
    const save = vi.spyOn(tokens, "save");
    const service = new AuthService(api({ pollDeviceAuthorization: poll }), tokens, () => now);
    await service.start();
    expect((await service.restore()).status).toBe("authorizing");
    now = 5_000;
    await Promise.all([service.pollOnce(), service.pollOnce()]);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });


  it("preserves retryable access errors while restore exposes recovery state", async () => {
    const error = new AgentLensError("network_unavailable", "offline", true);
    const tokens = persistence("refresh");
    const service = new AuthService(api({ refresh: vi.fn(async () => { throw error; }) }), tokens);
    await expect(service.accessToken()).rejects.toBe(error);
    expect(await service.restore()).toEqual({ status: "error", reason: "refresh_unavailable" });
    expect(tokens.value).toBe("refresh");
  });

  it("finishes logout before a new authorization and rejects background access meanwhile", async () => {
    let release!: () => void;
    const revoke = vi.fn(async () => { await new Promise<void>((resolve) => { release = resolve; }); });
    const tokens = persistence("old-refresh");
    const client = api({ revoke });
    const service = new AuthService(client, tokens);
    const logout = service.signOut();
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    const newLogin = service.start();
    expect(await service.accessToken()).toBeNull();
    expect(client.startDeviceAuthorization).not.toHaveBeenCalled();
    release();
    await Promise.all([logout, newLogin]);
    expect(service.snapshot().status).toBe("authorizing");
    expect(tokens.value).toBeNull();
  });

});
