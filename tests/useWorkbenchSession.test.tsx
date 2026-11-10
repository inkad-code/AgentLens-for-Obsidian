import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchSession } from "@/ui/workbench/useWorkbenchSession";
import type { AuthState } from "@/auth/AuthService";
import type { AgentLensWorkbenchPort } from "@/workbench/ports";
import type { AccountCapabilities } from "@/api/contracts";
import type { AccountSummary } from "@/api/AgentLensApiClient";

const caps = (accountId = "owner"): AccountCapabilities => ({ accountId, plan: "pro", quotaRemaining: 99,
  minimumPluginVersion: "0.1.0", latestPluginVersion: "0.1.0", supportUrl: "", releaseNotesUrl: "", platforms: [] });
const summary = (id = "owner"): AccountSummary => ({ user: { id, email: "a@example.com", name: id }, installationId: "installation",
  subscription: { plan: "pro", status: "active", periodEnd: null, remainingQuota: 99, totalQuota: 100,
    addOnBalance: 0, quotaRefreshAt: null, cancelAtPeriodEnd: false, billingUrl: "", fetchAllowed: true, fetchBlockedReason: null } });
function fixture() {
  let state: AuthState = { status: "signed_in", accessToken: "token", accessTokenExpiresAt: 9e12 };
  const listeners = new Set<(state: AuthState) => void>();
  const accountListeners = new Set<() => void>();
  const capabilities = vi.fn().mockResolvedValue(caps());
  const account = vi.fn().mockResolvedValue(summary());
  const restoreAuth = vi.fn(async (_force?: boolean) => state);
  const service = { authState: () => state, subscribeAuth: (next: (state: AuthState) => void) => {
    listeners.add(next); return () => { listeners.delete(next); };
  }, restoreAuth, capabilities, account, subscribeAccountChanges: (listener: () => void) => {
    accountListeners.add(listener); return () => { accountListeners.delete(listener); };
  } } as unknown as AgentLensWorkbenchPort;
  return { service, capabilities, account, restoreAuth,
    changed: () => { for (const listener of accountListeners) listener(); },
    emit: (next: AuthState) => { state = next; for (const listener of listeners) listener(next); } };
}
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const settle = async () => { await act(async () => {}); };

describe("workbench capability refresh", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("refreshes completed background charges promptly and preserves a completion during an in-flight read", async () => {
    vi.useFakeTimers();
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    let finish!: (value: AccountSummary) => void;
    f.account.mockImplementationOnce(() => new Promise<AccountSummary>(resolve => { finish = resolve; }));
    f.changed(); f.changed(); await advance(1);
    expect(f.account).toHaveBeenCalledTimes(2);
    f.changed();
    const updated = summary(); updated.subscription.remainingQuota = 87;
    f.account.mockResolvedValue(updated);
    await act(async () => { finish(summary()); });
    await advance(1);
    expect(f.account).toHaveBeenCalledTimes(3);
    expect(hook.result.current.account?.subscription.remainingQuota).toBe(87);
    expect(f.capabilities).toHaveBeenCalledTimes(1);
    hook.unmount(); f.changed(); await advance(1);
    expect(f.account).toHaveBeenCalledTimes(3);
  });

  it("defers background balance refresh while hidden and discards it after sign-out", async () => {
    vi.useFakeTimers(); let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const f = fixture(); renderHook(() => useWorkbenchSession(f.service)); await settle();
    visibility = "hidden"; f.changed(); await advance(10);
    expect(f.account).toHaveBeenCalledTimes(1);
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(f.account).toHaveBeenCalledTimes(2);
    await act(async () => { f.emit({status: "signed_out"}); });
    f.changed(); await advance(10); expect(f.account).toHaveBeenCalledTimes(2);
  });

  it("shares five-minute freshness across focus and visibility events and stops on unmount", async () => {
    vi.useFakeTimers();
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    expect(f.capabilities).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await advance(299_999); expect(f.capabilities).toHaveBeenCalledTimes(1);
    await advance(1); expect(f.capabilities).toHaveBeenCalledTimes(2); expect(f.account).toHaveBeenCalledTimes(2);
    hook.unmount(); await advance(600_000); expect(f.capabilities).toHaveBeenCalledTimes(2);
  });

  it("pauses hidden windows and coalesces wakeup and explicit refreshes while pending", async () => {
    vi.useFakeTimers(); let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    visibility = "hidden"; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(900_000); expect(f.capabilities).toHaveBeenCalledTimes(1);
    let finish!: (data: AccountCapabilities) => void;
    f.capabilities.mockImplementationOnce(() => new Promise<AccountCapabilities>(resolve => { finish = resolve; }));
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
    let manual!: Promise<void>;
    await act(async () => { manual = hook.result.current.refreshAccount(); });
    expect(f.capabilities).toHaveBeenCalledTimes(2); expect(f.account).toHaveBeenCalledTimes(3);
    await act(async () => { finish(caps()); await manual; });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(f.capabilities).toHaveBeenCalledTimes(2);
    await act(async () => { await hook.result.current.refreshAccount(); });
    expect(f.capabilities).toHaveBeenCalledTimes(3);
  });

  it("keeps last data through failures, backs off to fifteen minutes and resets on success", async () => {
    vi.useFakeTimers(); const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    f.capabilities.mockRejectedValue(new Error("offline")); await advance(300_000);
    expect(hook.result.current.capabilities).toEqual(caps()); expect(hook.result.current.capabilitiesError).toBe(true); expect(hook.result.current.accountStale).toBe(false);
    let calls = 2;
    for (const delay of [60_000, 120_000, 240_000, 480_000, 900_000, 900_000]) {
      await advance(delay - 1);
      await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
      expect(f.capabilities).toHaveBeenCalledTimes(calls);
      await advance(1); expect(f.capabilities).toHaveBeenCalledTimes(++calls);
      expect(hook.result.current.capabilities).toEqual(caps());
    }
    f.capabilities.mockResolvedValue(caps()); await advance(900_000);
    expect(hook.result.current.accountStale).toBe(false); expect(hook.result.current.authError).toBeNull();
    calls = f.capabilities.mock.calls.length; await advance(300_000); expect(f.capabilities).toHaveBeenCalledTimes(calls + 1);
  });

  it("discards old automatic/manual results after sign-out and refreshes immediately for a new session", async () => {
    vi.useFakeTimers(); const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    let finish!: (data: AccountCapabilities) => void;
    f.capabilities.mockImplementationOnce(() => new Promise<AccountCapabilities>(resolve => { finish = resolve; }));
    let manual!: Promise<void>;
    await act(async () => { manual = hook.result.current.refreshAccount(); });
    await act(async () => { f.emit({ status: "signed_out" }); });
    expect(hook.result.current.capabilities).toBeNull(); expect(hook.result.current.account).toBeNull();
    f.capabilities.mockResolvedValue(caps("new")); f.account.mockResolvedValue(summary("new"));
    await act(async () => { f.emit({ status: "signed_in", accessToken: "new-token", accessTokenExpiresAt: 9e12 }); });
    expect(hook.result.current.capabilities?.accountId).toBe("new");
    await act(async () => { finish(caps()); await manual; });
    expect(hook.result.current.capabilities?.accountId).toBe("new"); expect(hook.result.current.accountBusy).toBe(false);
  });
});


it("loads the public catalog without authentication or account requests", async () => {
  const f = fixture();
  f.emit({status:"signed_out"});
  const catalog = {clientType:"obsidian_plugin",platforms:[]};
  f.service.publicPlatformCatalog = vi.fn().mockResolvedValue(catalog);
  const hook = renderHook(() => useWorkbenchSession(f.service));
  await settle();
  expect(hook.result.current.publicCatalog).toEqual(catalog);
  expect(f.service.publicPlatformCatalog).toHaveBeenCalledTimes(1);
  expect(f.capabilities).not.toHaveBeenCalled();
  expect(f.account).not.toHaveBeenCalled();
  hook.unmount();
});


it("refreshes the guest catalog every five minutes and retains it during retry", async () => {
  vi.useFakeTimers();
  const f = fixture(); f.emit({status:"signed_out"});
  const catalog = {clientType:"obsidian_plugin",platforms:[]};
  const load = vi.fn().mockResolvedValue(catalog);
  f.service.publicPlatformCatalog = load;
  const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
  expect(load).toHaveBeenCalledTimes(1);
  load.mockRejectedValueOnce(new Error("offline"));
  await advance(300_000);
  expect(hook.result.current.publicCatalog).toEqual(catalog);
  expect(hook.result.current.publicCatalogError).toBe(true);
  await advance(60_000);
  expect(load).toHaveBeenCalledTimes(3);
  expect(hook.result.current.publicCatalogError).toBe(false);
  hook.unmount(); vi.useRealTimers();
});

it("keeps directory refresh healthy when the account endpoint fails", async () => {
  vi.useFakeTimers();const f=fixture();const h=renderHook(()=>useWorkbenchSession(f.service));await settle();
  f.account.mockRejectedValue(new Error("account offline"));await advance(300000);
  expect(h.result.current.accountStale).toBe(true);expect(h.result.current.capabilitiesError).toBe(false);
  expect(f.capabilities).toHaveBeenCalledTimes(2);
  await advance(60000);expect(f.account).toHaveBeenCalledTimes(3);expect(f.capabilities).toHaveBeenCalledTimes(2);
  h.unmount();vi.useRealTimers();
});

it("refreshes scoped capabilities immediately when the account plan changes", async () => {
  const f=fixture();const h=renderHook(()=>useWorkbenchSession(f.service));await settle();
  f.account.mockResolvedValue({...summary(),subscription:{...summary().subscription,plan:"mega"}});
  f.capabilities.mockResolvedValue({...caps(),plan:"mega"});
  await act(async()=>{await h.result.current.refreshAccount();});await settle();
  expect(h.result.current.capabilities?.plan).toBe("mega");expect(h.result.current.capabilitiesError).toBe(false);
  h.unmount();
});

describe("workbench saved-session recovery", () => {
  const signedIn = (): Extract<AuthState, { status: "signed_in" }> => ({ status: "signed_in", accessToken: "token", accessTokenExpiresAt: 9e12 });
  const recoveryAt = (delay: number, attempt = 1) => ({ attempt, nextRetryAt: Date.now() + delay,
    code: "SERVER_BUSY", status: 503, requestId: `refresh-${attempt}` });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T00:00:00Z"));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("retains the confirmed account and platform directory while session refresh is unavailable", async () => {
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    const account = hook.result.current.account;
    const directory = hook.result.current.capabilities;
    expect(account?.user.id).toBe("owner"); expect(directory?.accountId).toBe("owner");
    const recovery = recoveryAt(30_000);
    await act(async () => { f.emit({ ...signedIn(), status: "signed_in", recovery }); });
    expect(hook.result.current.authState.status).toBe("signed_in");
    expect(hook.result.current.sessionRecovery).toEqual(recovery);
    expect(hook.result.current.account).toBe(account);
    expect(hook.result.current.capabilities).toBe(directory);
    expect(hook.result.current.publicCatalog).toBeNull();
    expect(f.account).toHaveBeenCalledTimes(1); expect(f.capabilities).toHaveBeenCalledTimes(1);
    expect(f.restoreAuth).toHaveBeenCalledTimes(1);
  });

  it("immediately loads a missing account and directory after the saved session recovers", async () => {
    const f = fixture();
    f.emit({ ...signedIn(), accessTokenExpiresAt: Date.now() - 1, recovery: recoveryAt(5_000) });
    f.account.mockRejectedValueOnce(new Error("Saved session is temporarily unavailable"));
    const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    expect(hook.result.current.account).toBeNull(); expect(hook.result.current.capabilities).toBeNull();
    expect(hook.result.current.authError).not.toBeNull();
    expect(f.account).toHaveBeenCalledTimes(1); expect(f.capabilities).not.toHaveBeenCalled();
    f.restoreAuth.mockImplementationOnce(async () => { const next = signedIn(); f.emit(next); return next; });
    await advance(5_000);
    expect(f.account).toHaveBeenCalledTimes(2); expect(f.capabilities).toHaveBeenCalledTimes(1);
    expect(hook.result.current.account?.user.id).toBe("owner");
    expect(hook.result.current.capabilities?.accountId).toBe("owner");
    expect(hook.result.current.accountStale).toBe(false); expect(hook.result.current.authError).toBeNull();
  });

  it("revalidates after recovery while retaining existing snapshots until the new data arrives", async () => {
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    const previousAccount = hook.result.current.account; const previousDirectory = hook.result.current.capabilities;
    let finishAccount!: (account: AccountSummary) => void;
    let finishDirectory!: (directory: AccountCapabilities) => void;
    f.account.mockImplementationOnce(() => new Promise<AccountSummary>(resolve => { finishAccount = resolve; }));
    f.capabilities.mockImplementationOnce(() => new Promise<AccountCapabilities>(resolve => { finishDirectory = resolve; }));
    await act(async () => { f.emit({ ...signedIn(), recovery: recoveryAt(5_000) }); });
    f.restoreAuth.mockImplementationOnce(async () => { const next = signedIn(); f.emit(next); return next; });
    await advance(5_000);
    expect(f.account).toHaveBeenCalledTimes(2); expect(f.capabilities).toHaveBeenCalledTimes(2);
    expect(hook.result.current.account).toBe(previousAccount);
    expect(hook.result.current.capabilities).toBe(previousDirectory);
    const freshAccount = { ...summary(), user: { ...summary().user, name: "Updated after recovery" } };
    const freshDirectory = { ...caps(), quotaRemaining: 88 };
    await act(async () => { finishAccount(freshAccount); finishDirectory(freshDirectory); });
    expect(hook.result.current.account?.user.name).toBe("Updated after recovery");
    expect(hook.result.current.capabilities?.quotaRemaining).toBe(88);
    expect(hook.result.current.authError).toBeNull();
  });

  it("respects each retry deadline across timers and wakeup events", async () => {
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    const firstRecovery = recoveryAt(10_000);
    await act(async () => { f.emit({ ...signedIn(), status: "signed_in", recovery: firstRecovery }); });
    f.restoreAuth.mockImplementationOnce(async () => {
      const next: AuthState = { ...signedIn(), status: "signed_in", recovery: recoveryAt(20_000, 2) };
      f.emit(next); return next;
    }).mockImplementationOnce(async () => { const next = signedIn(); f.emit(next); return next; });
    await advance(9_999);
    await act(async () => {
      window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(f.restoreAuth).toHaveBeenCalledTimes(1);
    await advance(1); expect(f.restoreAuth).toHaveBeenCalledTimes(2);
    expect(hook.result.current.sessionRecovery?.attempt).toBe(2);
    expect(f.restoreAuth.mock.calls[1]?.[0]).not.toBe(true);
    await advance(19_999);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(f.restoreAuth).toHaveBeenCalledTimes(2);
    await advance(1); expect(f.restoreAuth).toHaveBeenCalledTimes(3);
    expect(hook.result.current.sessionRecovery).toBeFalsy();
    await advance(600_000);
    await act(async () => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
    expect(f.restoreAuth).toHaveBeenCalledTimes(3);
  });

  it("coalesces recovery wakeups while a request is in flight and exposes its busy state", async () => {
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    let finish!: (state: AuthState) => void;
    f.restoreAuth.mockImplementationOnce(() => new Promise<AuthState>(resolve => { finish = resolve; }));
    await act(async () => { f.emit({ ...signedIn(), status: "signed_in", recovery: recoveryAt(1_000) }); });
    await advance(1_000);
    expect(hook.result.current.authRecovering).toBe(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);
    expect(f.restoreAuth).toHaveBeenCalledTimes(2);
    await act(async () => { const next = signedIn(); f.emit(next); finish(next); });
    expect(hook.result.current.authRecovering).toBe(false);
    expect(hook.result.current.sessionRecovery).toBeFalsy();
  });

  it("defers recovery while offline or hidden and retries when both become available", async () => {
    let online = true; let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    f.restoreAuth.mockImplementationOnce(async () => { const next = signedIn(); f.emit(next); return next; });
    await act(async () => { f.emit({ ...signedIn(), status: "signed_in", recovery: recoveryAt(1_000) }); });
    online = false; visibility = "hidden";
    await act(async () => { window.dispatchEvent(new Event("offline")); document.dispatchEvent(new Event("visibilitychange")); });
    await advance(2_000); expect(f.restoreAuth).toHaveBeenCalledTimes(1);
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
    expect(f.restoreAuth).toHaveBeenCalledTimes(1);
    visibility = "hidden"; online = true;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("online")); });
    expect(f.restoreAuth).toHaveBeenCalledTimes(1);
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(0);
    expect(f.restoreAuth).toHaveBeenCalledTimes(2);
    expect(hook.result.current.sessionRecovery).toBeFalsy();
  });

  it("lets an explicit retry bypass cooldown and clears recovery after success", async () => {
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    await act(async () => { f.emit({ ...signedIn(), status: "signed_in", recovery: recoveryAt(60_000) }); });
    let finish!: (state: AuthState) => void;
    f.restoreAuth.mockImplementationOnce(() => new Promise<AuthState>(resolve => { finish = resolve; }));
    let manual!: Promise<void>;
    await act(async () => { manual = hook.result.current.retryRestore(); });
    expect(f.restoreAuth).toHaveBeenLastCalledWith(true);
    expect(hook.result.current.authRecovering).toBe(true);
    await act(async () => { const next = signedIn(); f.emit(next); finish(next); await manual; });
    expect(hook.result.current.authRecovering).toBe(false);
    expect(hook.result.current.sessionRecovery).toBeFalsy();
    await advance(120_000); expect(f.restoreAuth).toHaveBeenCalledTimes(2);
  });

  it("recovers an initially unconfirmed saved session without loading private account data early", async () => {
    const f = fixture(); const recovery = recoveryAt(5_000);
    f.emit({ status: "error", reason: "refresh_unavailable", recovery });
    f.service.publicPlatformCatalog = vi.fn().mockResolvedValue({ clientType: "obsidian_plugin", platforms: [] });
    const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    expect(hook.result.current.authState.status).toBe("error");
    expect(hook.result.current.sessionRecovery).toEqual(recovery);
    expect(f.account).not.toHaveBeenCalled(); expect(f.capabilities).not.toHaveBeenCalled();
    f.restoreAuth.mockImplementationOnce(async () => { const next = signedIn(); f.emit(next); return next; });
    await advance(5_000);
    expect(f.restoreAuth).toHaveBeenCalledTimes(2);
    expect(hook.result.current.authState.status).toBe("signed_in");
    expect(hook.result.current.account?.user.id).toBe("owner");
    expect(hook.result.current.sessionRecovery).toBeFalsy();
  });

  it("schedules recovery for older services that omit retry metadata", async () => {
    const f = fixture(); f.emit({ status: "error", reason: "refresh_unavailable" });
    const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    const recovery = hook.result.current.sessionRecovery;
    expect(recovery?.attempt).toBe(1); expect(recovery?.nextRetryAt).toBeGreaterThan(Date.now());
    expect(f.account).not.toHaveBeenCalled(); expect(f.capabilities).not.toHaveBeenCalled();
    f.restoreAuth.mockImplementationOnce(async () => { const next = signedIn(); f.emit(next); return next; });
    await advance(recovery!.nextRetryAt - Date.now());
    expect(f.restoreAuth).toHaveBeenCalledTimes(2);
    expect(hook.result.current.authState.status).toBe("signed_in");
    expect(hook.result.current.sessionRecovery).toBeFalsy();
  });

  it.each<AuthState>([
    { status: "signed_out" },
    { status: "error", reason: "refresh_failed" },
    { status: "error", reason: "credential_unavailable" },
    { status: "authorizing", authorization: { deviceCode: "device", userCode: "CODE", verificationUri: "https://example.com/device", expiresIn: 600, interval: 5 },
      expiresAt: 9e12, nextPollAt: 9e12 }
  ])("does not automatically restore a signed-out, invalid, or authorizing session: %j", async state => {
    const f = fixture(); f.emit(state.status === "authorizing"
      ? { ...state, expiresAt: Date.now() + 3_600_000, nextPollAt: Date.now() + 3_600_000 } : state);
    const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    await advance(60_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(f.restoreAuth).toHaveBeenCalledTimes(1);
    expect(hook.result.current.sessionRecovery).toBeFalsy();
  });

  it("cancels scheduled recovery at sign-out and ignores a late pending retry error", async () => {
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    await act(async () => { f.emit({ ...signedIn(), status: "signed_in", recovery: recoveryAt(30_000) }); });
    let reject!: (error: Error) => void;
    f.restoreAuth.mockImplementationOnce(() => new Promise<AuthState>((_resolve, fail) => { reject = fail; }));
    let manual!: Promise<void>;
    await act(async () => { manual = hook.result.current.retryRestore(); });
    await act(async () => { f.emit({ status: "signed_out" }); });
    await act(async () => { reject(new Error("Old session failed")); await manual; });
    expect(hook.result.current.authState.status).toBe("signed_out");
    expect(hook.result.current.sessionRecovery).toBeFalsy();
    expect(hook.result.current.authError).toBeNull();
    expect(hook.result.current.account).toBeNull(); expect(hook.result.current.capabilities).toBeNull();
    await advance(60_000); expect(f.restoreAuth).toHaveBeenCalledTimes(2);
  });

  it("stops recovery timers when the hook unmounts", async () => {
    const f = fixture(); const hook = renderHook(() => useWorkbenchSession(f.service)); await settle();
    await act(async () => { f.emit({ ...signedIn(), status: "signed_in", recovery: recoveryAt(30_000) }); });
    hook.unmount(); await advance(600_000);
    await act(async () => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
    expect(f.restoreAuth).toHaveBeenCalledTimes(1);
  });

  it("isolates a replacement service from the old recovery promise and subscription", async () => {
    const first = fixture(); const second = fixture();
    second.account.mockResolvedValue(summary("new-owner")); second.capabilities.mockResolvedValue(caps("new-owner"));
    const hook = renderHook(({ service }) => useWorkbenchSession(service), { initialProps: { service: first.service } });
    await settle();
    let rejectOld!: (error: Error) => void;
    first.restoreAuth.mockImplementationOnce(() => new Promise<AuthState>((_resolve, reject) => { rejectOld = reject; }));
    await act(async () => { first.emit({ ...signedIn(), status: "signed_in", recovery: recoveryAt(1_000) }); });
    await advance(1_000); expect(hook.result.current.authRecovering).toBe(true);
    let finishNew!: (state: AuthState) => void;
    second.restoreAuth.mockImplementationOnce(() => new Promise<AuthState>(resolve => { finishNew = resolve; }));
    hook.rerender({ service: second.service }); await settle();
    expect(hook.result.current.authRestoring).toBe(true);
    await act(async () => {
      rejectOld(new Error("Previous service failed"));
      first.emit({ status: "error", reason: "refresh_unavailable", recovery: recoveryAt(30_000) });
    });
    expect(hook.result.current.authError).toBeNull(); expect(hook.result.current.authRestoring).toBe(true);
    await act(async () => { const next = signedIn(); second.emit(next); finishNew(next); });
    expect(hook.result.current.authState.status).toBe("signed_in");
    expect(hook.result.current.account?.user.id).toBe("new-owner");
    expect(hook.result.current.capabilities?.accountId).toBe("new-owner");
    expect(hook.result.current.sessionRecovery).toBeFalsy(); expect(hook.result.current.authRecovering).toBe(false);
    expect(first.restoreAuth).toHaveBeenCalledTimes(2); expect(second.restoreAuth).toHaveBeenCalledTimes(1);
  });
});
