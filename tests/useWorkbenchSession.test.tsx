import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  let listener: (state: AuthState) => void = () => {};
  const capabilities = vi.fn().mockResolvedValue(caps());
  const account = vi.fn().mockResolvedValue(summary());
  const service = { authState: () => state, subscribeAuth: (next: typeof listener) => { listener = next; return () => {}; },
    restoreAuth: async () => state, capabilities, account } as unknown as AgentLensWorkbenchPort;
  return { service, capabilities, account, emit: (next: AuthState) => { state = next; listener(next); } };
}
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const settle = async () => { await act(async () => {}); };

describe("workbench capability refresh", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

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
