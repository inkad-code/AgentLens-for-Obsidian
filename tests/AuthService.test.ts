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

    expect(await service.restore()).toMatchObject({ status: "error", reason: "refresh_unavailable", recovery: {attempt: 1, nextRetryAt: 6_000, code: "network_unavailable"} });
    expect(tokens.value).toBe("refresh-1");
    expect(await service.restore(true)).toEqual({
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

  it.each([false, true])("revokes the rotated credential when logout overtakes a refresh (persistence fails: %s)", async (persistenceFails) => {
    const tokens = persistence("refresh-old");
    if (persistenceFails) vi.spyOn(tokens, "save").mockRejectedValueOnce(new Error("SecretStorage is unavailable"));
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
    expect(await service.restore()).toMatchObject({ status: "error", reason: "refresh_unavailable", recovery: {attempt: 1, code: "network_unavailable"} });
    expect(tokens.value).toBe("refresh");
  });

  it("keeps a valid access token and the signed-in session after a temporary early refresh failure", async () => {
    let now = 0;
    const unavailable = new AgentLensError("provider_unavailable", "Temporary outage", true, 503, undefined, "request-7");
    const refresh = vi.fn()
      .mockResolvedValueOnce({accessToken: "still-valid", expiresIn: 60})
      .mockRejectedValueOnce(unavailable);
    const tokens = persistence("saved-refresh");
    const service = new AuthService(api({refresh}), tokens, () => now);
    await service.restore();

    now = 31_000;
    await expect(service.accessToken()).resolves.toBe("still-valid");
    expect(service.snapshot()).toEqual({
      status: "signed_in", accessToken: "still-valid", accessTokenExpiresAt: 60_000,
      clientType: "obsidian_plugin",
      recovery: {attempt: 1, nextRetryAt: 36_000, code: "provider_unavailable", status: 503, requestId: "request-7"}
    });
    await expect(service.accessToken()).resolves.toBe("still-valid");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(tokens.value).toBe("saved-refresh");
  });

  it("blocks an expired token during cooldown and recovers when the next retry succeeds", async () => {
    let now = 0;
    const unavailable = new AgentLensError("network_unavailable", "offline", true);
    const refresh = vi.fn()
      .mockResolvedValueOnce({accessToken: "old-access", expiresIn: 35})
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({accessToken: "new-access", expiresIn: 60});
    const service = new AuthService(api({refresh}), persistence("saved-refresh"), () => now);
    await service.restore();

    now = 34_000;
    await expect(service.accessToken()).resolves.toBe("old-access");
    now = 35_000;
    await expect(service.accessToken()).rejects.toBe(unavailable);
    expect(service.snapshot()).toMatchObject({status: "signed_in", recovery: {nextRetryAt: 39_000}});
    expect(refresh).toHaveBeenCalledTimes(2);

    now = 39_000;
    await expect(service.accessToken()).resolves.toBe("new-access");
    expect(service.snapshot()).toEqual({status: "signed_in", accessToken: "new-access", accessTokenExpiresAt: 99_000, clientType: "obsidian_plugin"});
  });

  it("backs off repeated cold-session refreshes and lets a manual restore bypass cooldown", async () => {
    let now = 1_000;
    const unavailable = new AgentLensError("network_unavailable", "offline", true);
    const refresh = vi.fn().mockRejectedValue(unavailable);
    const service = new AuthService(api({refresh}), persistence("saved-refresh"), () => now);

    for (const [index, delay] of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000].entries()) {
      const state = await service.restore();
      expect(state).toMatchObject({status: "error", reason: "refresh_unavailable", recovery: {attempt: index + 1, nextRetryAt: now + delay}});
      await service.restore();
      await expect(service.accessToken()).rejects.toBe(unavailable);
      expect(refresh).toHaveBeenCalledTimes(index + 1);
      now += delay;
    }
    now -= 59_000;
    await service.restore(true);
    expect(refresh).toHaveBeenCalledTimes(7);
    expect(service.snapshot()).toMatchObject({recovery: {attempt: 7, nextRetryAt: now + 60_000}});
  });

  it("resets retry backoff after a successful recovery", async () => {
    let now = 0;
    const unavailable = new AgentLensError("network_unavailable", "offline", true);
    const refresh = vi.fn()
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({accessToken: "recovered", expiresIn: 60})
      .mockRejectedValueOnce(unavailable);
    const service = new AuthService(api({refresh}), persistence("saved-refresh"), () => now);
    await service.restore();
    await service.restore(true);
    now = 31_000;
    await expect(service.accessToken()).resolves.toBe("recovered");
    expect(service.snapshot()).toMatchObject({status: "signed_in", recovery: {attempt: 1, nextRetryAt: 36_000}});
  });

  it("clears an explicitly invalid credential instead of falling back to a still-valid access token", async () => {
    let now = 0;
    const tokens = persistence("saved-refresh");
    const refresh = vi.fn()
      .mockResolvedValueOnce({accessToken: "old-access", expiresIn: 60})
      .mockRejectedValueOnce(new AgentLensError("network_unavailable", "offline", true))
      .mockRejectedValueOnce(new AgentLensError("auth_required", "invalid grant", false, 401));
    const service = new AuthService(api({refresh}), tokens, () => now);
    await service.restore();
    now = 31_000;
    await service.accessToken();
    expect(await service.restore(true)).toEqual({status: "error", reason: "refresh_failed"});
    expect(tokens.value).toBeNull();
    await expect(service.accessToken()).resolves.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("never falls back to a rejected access token if clearing the invalid credential also fails", async () => {
    let now = 0;
    const tokens = persistence("invalid-refresh");
    const clearError = new Error("SecretStorage is unavailable");
    vi.spyOn(tokens, "clear").mockRejectedValueOnce(clearError);
    const refresh = vi.fn()
      .mockResolvedValueOnce({accessToken: "rejected-access", expiresIn: 60})
      .mockRejectedValueOnce(new AgentLensError("auth_required", "invalid grant", false, 401));
    const service = new AuthService(api({refresh}), tokens, () => now);
    await service.restore();
    now = 31_000;
    await expect(service.accessToken()).rejects.toBe(clearError);
    expect(service.snapshot()).toEqual({status: "error", reason: "refresh_failed"});
  });

  it("does not restore the session when an in-flight recovery fails after logout", async () => {
    let now = 0;
    let rejectRefresh!: (error: Error) => void;
    const refresh = vi.fn()
      .mockResolvedValueOnce({accessToken: "old-access", expiresIn: 60})
      .mockImplementationOnce(() => new Promise((_, reject) => {rejectRefresh = reject;}));
    const tokens = persistence("saved-refresh");
    const service = new AuthService(api({refresh}), tokens, () => now);
    await service.restore();
    now = 31_000;
    const recovering = service.accessToken();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    const logout = service.signOut();
    rejectRefresh(new AgentLensError("network_unavailable", "offline", true));
    await expect(recovering).resolves.toBeNull();
    await logout;
    expect(service.snapshot()).toEqual({status: "signed_out"});
    expect(tokens.value).toBeNull();
  });

  it("starts a newly authorized session without inheriting a previous retry cooldown", async () => {
    let now = 0;
    const refresh = vi.fn().mockRejectedValue(new AgentLensError("network_unavailable", "offline", true));
    const authApi = api({refresh, pollDeviceAuthorization: vi.fn(async () => ({status: "authorized" as const, accessToken: "new-session", expiresIn: 60, refreshToken: "new-refresh"}))});
    const service = new AuthService(authApi, persistence("saved-refresh"), () => now);
    await service.restore();
    await service.restore(true);
    await service.start();
    now = 5_000;
    await service.pollOnce();
    expect(service.snapshot()).not.toHaveProperty("recovery");
    now = 36_000;
    await expect(service.accessToken()).resolves.toBe("new-session");
    expect(service.snapshot()).toMatchObject({status: "signed_in", recovery: {attempt: 1, nextRetryAt: 41_000}});
  });

  it("retries saving a rotated credential before reusing it instead of replaying the old refresh token", async () => {
    const tokens = persistence("old-refresh");
    const save = vi.spyOn(tokens, "save").mockRejectedValueOnce(new Error("SecretStorage is unavailable"));
    const refresh = vi.fn()
      .mockResolvedValueOnce({accessToken: "first-access", expiresIn: 60, refreshToken: "rotated-refresh"})
      .mockResolvedValueOnce({accessToken: "second-access", expiresIn: 60, refreshToken: "latest-refresh"});
    const service = new AuthService(api({refresh}), tokens, () => 0);
    expect(await service.restore()).toMatchObject({status: "error", reason: "refresh_unavailable"});
    expect(tokens.value).toBe("old-refresh");
    expect(await service.restore(true)).toMatchObject({status: "signed_in", accessToken: "second-access"});
    expect(refresh.mock.calls).toEqual([["old-refresh"], ["rotated-refresh"]]);
    expect(save.mock.calls).toEqual([["rotated-refresh"], ["rotated-refresh"], ["latest-refresh"]]);
    expect(tokens.value).toBe("latest-refresh");
  });

  it("revokes the latest rotated credential on logout even if its persistence failed", async () => {
    const tokens = persistence("old-refresh");
    vi.spyOn(tokens, "save").mockRejectedValueOnce(new Error("SecretStorage is unavailable"));
    const revoke = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => ({accessToken: "access", expiresIn: 60, refreshToken: "rotated-refresh"}));
    const service = new AuthService(api({refresh, revoke}), tokens, () => 0);
    await service.restore();
    await service.signOut();
    expect(revoke).toHaveBeenCalledWith("rotated-refresh");
    expect(tokens.value).toBeNull();
    expect(await service.restore()).toEqual({status: "signed_out"});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("replaces an unsaved rotated credential when a different account finishes signing in", async () => {
    let now = 0;
    const tokens = persistence("previous-account-refresh");
    vi.spyOn(tokens, "save").mockRejectedValueOnce(new Error("SecretStorage is unavailable"));
    const refresh = vi.fn()
      .mockResolvedValueOnce({accessToken: "previous-account-access", expiresIn: 60, refreshToken: "unsaved-previous-refresh"})
      .mockResolvedValueOnce({accessToken: "new-account-access", expiresIn: 60, refreshToken: "new-account-rotated-refresh"});
    const authApi = api({refresh, pollDeviceAuthorization: vi.fn(async () => ({status: "authorized" as const,
      accessToken: "new-account-access", expiresIn: 60, refreshToken: "new-account-refresh"}))});
    const service = new AuthService(authApi, tokens, () => now);
    await service.restore();
    await service.start();
    now = 5_000;
    await service.pollOnce();
    now = 36_000;
    await expect(service.accessToken()).resolves.toBe("new-account-access");
    expect(refresh.mock.calls).toEqual([["previous-account-refresh"], ["new-account-refresh"]]);
    expect(tokens.value).toBe("new-account-rotated-refresh");
  });

  it("publishes only structured recovery diagnostics without raw errors or secrets", async () => {
    const error = new AgentLensError("network_unavailable", "Request failed: Bearer private-access; refresh=private-refresh", true, 503,
      {cause: new Error("password=private-password")}, "https://example.com?token=private-token");
    const service = new AuthService(api({refresh: vi.fn().mockRejectedValue(error)}), persistence("private-refresh"), () => 100);
    const state = await service.restore();
    expect(state).toEqual({status: "error", reason: "refresh_unavailable", recovery: {attempt: 1, nextRetryAt: 5_100, code: "network_unavailable", status: 503}});
    expect(JSON.stringify(state)).not.toMatch(/private-|Bearer|password|https:/);
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
