import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBilling } from "../src/ui/workbench/useBilling";
import { AgentLensError } from "../src/core/errors";
import type { BillingPort, PendingCheckout } from "../src/api/billing";

function fixture() {
  const details = { oldOrderId: "old-order", intentId: "new-intent", plan: "ultra", billingCycle: "yearly", paymentMethod: "wallet", amount: 69.9, currency: "USD", requestKey: "intent:new-intent" };
  const error = new AgentLensError("unknown", "Confirm replacement", false, 409, undefined, undefined, undefined, "CHECKOUT_REPLACEMENT_REQUIRED", details);
  const billing: BillingPort = {
    plans: vi.fn(async () => []), dashboard: vi.fn(async () => ({ plan: "basic" as const, billingCycle: "monthly" as const, subscriptionStatus: "active", scheduledPlan: null, scheduledBillingCycle: null, scheduledEffectiveAt: null, checkoutStatus: null, fetchReason: null })),
    createIntent: vi.fn(async () => ({ id: "new-intent", displayedAmount: 69.9, currency: "USD", checkoutStatus: "not_started" })),
    intent: vi.fn(async () => ({ id: "new-intent", displayedAmount: 69.9, currency: "USD", checkoutStatus: "pending" })),
    paymentOptions: vi.fn(async () => ({ walletAvailable: true })),
    checkout: vi.fn().mockRejectedValueOnce(error).mockRejectedValue(new Error("Lost provider response")),
    change: vi.fn(), portal: vi.fn(), subscription: vi.fn()
  };
  return { billing, details };
}
const selection = { itemType: "subscription", plan: "ultra", billingCycle: "yearly" } as const;
describe("independent checkout replacement", () => {
  it("requires confirmation, preserves its exact retry identity and does not start a second intent", async () => {
    const { billing, details } = fixture();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    const { result } = renderHook(() => useBilling(billing, "account"));
    await waitFor(() => expect(result.current.dashboard).not.toBeNull());
    await act(() => result.current.prepare(selection, "wallet"));
    expect(result.current.replacementDescription).toContain("US$69.9 for one year");
    expect(result.current.replacementDescription).toContain("No automatic renewal");
    expect(billing.checkout).toHaveBeenCalledTimes(1);
    await act(() => result.current.confirm());
    expect(billing.checkout).toHaveBeenLastCalledWith("new-intent", "wallet", { requestKey: details.requestKey, replacesOrderId: "old-order", confirmed: true, confirmedAmount: 69.9, currency: "USD" });
    await act(() => result.current.reopen());
    expect(billing.checkout).toHaveBeenCalledTimes(3);
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
  });
  it("canceling a replacement does not send the closure confirmation", async () => {
    const { billing } = fixture();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, close: vi.fn() } as unknown as Window);
    const { result } = renderHook(() => useBilling(billing, "account"));
    await waitFor(() => expect(result.current.dashboard).not.toBeNull());
    await act(() => result.current.prepare(selection, "wallet"));
    act(() => result.current.cancel());
    expect(result.current.confirmation).toBeNull();expect(billing.checkout).toHaveBeenCalledTimes(1);expect(billing.subscription).not.toHaveBeenCalled();
  });
  it("recovers a persisted close/create after a fresh client instance without creating another intent", async () => {
    const { billing } = fixture();
    billing.pendingCheckout = vi.fn(async () => ({ intentId: "new-intent", plan: "ultra" as const, billingCycle: "yearly" as const, paymentMethod: "wallet" as const, amount: 69.9, currency: "USD", requestKey: "intent:new-intent" }));
    vi.mocked(billing.checkout).mockReset().mockRejectedValue(new Error("Still reconciling"));
    const { result } = renderHook(() => useBilling(billing, "account"));
    await waitFor(() => expect(result.current.pending?.intentId).toBe("new-intent"));
    await act(() => result.current.reopen());
    expect(billing.checkout).toHaveBeenLastCalledWith("new-intent", "wallet", { requestKey: "intent:new-intent" });expect(billing.createIntent).not.toHaveBeenCalled();
  });
  it("ignores a previous account's late recovery response", async () => {
    const { billing } = fixture();
    let finish!: (value: PendingCheckout | null) => void;
    billing.pendingCheckout = vi.fn().mockImplementationOnce(() => new Promise<PendingCheckout | null>(resolve => { finish = resolve; })).mockResolvedValue(null);
    const { result, rerender } = renderHook(({ account }) => useBilling(billing, account), { initialProps: { account: "old-account" } });
    await waitFor(() => expect(billing.pendingCheckout).toHaveBeenCalledTimes(1));
    rerender({ account: "new-account" });
    await waitFor(() => expect(billing.pendingCheckout).toHaveBeenCalledTimes(2));
    await act(async () => finish({ intentId: "private-old-intent", plan: "ultra", billingCycle: "yearly", paymentMethod: "wallet", amount: 69.9, currency: "USD", requestKey: "old-key" }));
    expect(result.current.pending).toBeNull();expect(result.current.busy).toBe(false);
  });

  it("returns to the original unknown operation when another selection is blocked", async () => {
    const { billing } = fixture();
    billing.pendingCheckout = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ intentId: "original-intent", plan: "pro", billingCycle: "monthly", paymentMethod: "card", amount: 2.9, currency: "USD", requestKey: "original-key" });
    vi.mocked(billing.checkout).mockReset().mockRejectedValue(new AgentLensError("unknown", "Reconcile original", false, 409, undefined, undefined, undefined, "PAYMENT_PENDING"));
    vi.spyOn(window, "open").mockReturnValue({ opener: null, close: vi.fn() } as unknown as Window);
    const { result } = renderHook(() => useBilling(billing, "account"));
    await waitFor(() => expect(result.current.dashboard).not.toBeNull());
    await act(() => result.current.prepare(selection, "wallet"));
    expect(result.current.pending?.intentId).toBe("original-intent");
    await act(() => result.current.reopen());
    expect(billing.checkout).toHaveBeenLastCalledWith("original-intent", "card", { requestKey: "original-key" });
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
  });

  it("does not open a checkout after switching accounts while its response is pending", async () => {
    const { billing } = fixture();
    let finish!: (value: { checkoutUrl: string; status: string }) => void;
    vi.mocked(billing.checkout).mockReset().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const replace = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace }, close: vi.fn() } as unknown as Window);
    const { result, rerender } = renderHook(({ account }) => useBilling(billing, account), { initialProps: { account: "old-account" } });
    await waitFor(() => expect(result.current.dashboard).not.toBeNull());
    let pending!: Promise<void>;
    act(() => { pending = result.current.prepare(selection, "wallet"); });
    await waitFor(() => expect(billing.checkout).toHaveBeenCalledTimes(1));
    const callsBefore = open.mock.calls.length;
    rerender({ account: "new-account" });
    await act(async () => { finish({ checkoutUrl: "https://checkout.stripe.com/c/old-account", status: "pending" }); await pending; });
    expect(open.mock.calls.length).toBe(callsBefore); expect(replace).not.toHaveBeenCalled();
  });

});
