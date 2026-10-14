import { describe, expect, it } from "vitest";
import { AgentLensApiClient } from "@/api/AgentLensApiClient";
import { billingAction, validateDashboard, secureBillingUrl, type BillingDashboard } from "@/api/billing";
import type { JsonTransport, TransportRequest } from "@/runtime/ObsidianRequestUrlTransport";

const state: BillingDashboard = { plan: "pro", billingCycle: "monthly", subscriptionStatus: "active", scheduledPlan: null, scheduledBillingCycle: null, scheduledEffectiveAt: null, checkoutStatus: null, fetchReason: null };
describe("deployed billing contract", () => {
  it("routes existing subscriptions without creating a duplicate subscription", () => {
    expect(billingAction(state, "pro", "monthly")).toBe("current");
    expect(billingAction(state, "ultra", "monthly")).toBe("upgrade");
    expect(billingAction(state, "pro", "yearly")).toBe("upgrade");
    expect(billingAction({ ...state, billingCycle: "yearly" }, "pro", "monthly")).toBe("schedule-change");
    expect(billingAction(state, "basic", "monthly")).toBe("schedule-change");
    expect(billingAction({ ...state, billingCycle: "yearly" }, "ultra", "yearly")).toBe("upgrade");
    expect(billingAction({ ...state, fetchReason: "SUBSCRIPTION_EXPIRED" }, "pro", "monthly")).toBe("checkout");
  });
  it("uses plain web JSON and authenticates every billing endpoint", async () => {
    const requests: TransportRequest[] = [];
    const responses: unknown[] = [
      [{ plan: "pro", priceMonthly: 3, priceYearly: 30, creditsLimit: 300, active: true }],
      state, { id: "intent/1", displayedAmount: 3, currency: "USD", checkoutStatus: "not_started" },
      { checkoutUrl: "https://checkout.stripe.com/c/pay", status: "pending" },
      { id: "intent/1", displayedAmount: 3, currency: "USD", checkoutStatus: "paid" },
      { status: "payment_pending", invoiceUrl: "https://invoice.stripe.com/1" },
      { status: "change_scheduled", effectiveAt: "2026-11-01" }, { portalUrl: "https://billing.stripe.com/1" },
      { status: "cancel_scheduled" }, { status: "change_cancelled" }, { status: "resumed" }
    ];
    const transport: JsonTransport = { json: async (request, validate) => { requests.push(request); return validate(responses.shift()); } };
    const api = new AgentLensApiClient(transport, { installationId: "i", deviceId: "d", clientVersion: "1", obsidianVersion: "1", platform: "desktop_windows" }).billing("token");
    expect((await api.plans())[0]?.priceMonthly).toBe(3);
    await api.dashboard();
    await api.createIntent({ itemType: "addon", addonCredits: 200 });
    await api.checkout("intent/1"); await api.intent("intent/1");
    await api.change("upgrade", "ultra", "yearly"); await api.change("schedule-change", "pro", "monthly"); await api.portal();
    await api.subscription("cancel-at-period-end"); await api.subscription("cancel-scheduled-change"); await api.subscription("resume");
    expect(requests.every(request => request.accessToken === "token")).toBe(true);
    expect(requests[2]).toMatchObject({ path: "/billing/purchase-intents", body: { itemType: "addon", addonCredits: 200, sourcePage: "obsidian/plans" } });
    expect(requests[3]).toMatchObject({ path: "/billing/checkout", body: { intentId: "intent/1" } });
    expect(requests[4]?.path).toBe("/billing/purchase-intents/intent%2F1");
    expect(requests.slice(8).map(request => ({ path: request.path, method: request.method }))).toEqual([
      { path: "/billing/subscriptions/cancel-at-period-end", method: "POST" },
      { path: "/billing/subscriptions/cancel-scheduled-change", method: "POST" },
      { path: "/billing/subscriptions/resume", method: "POST" }
    ]);
  });
  it("reads cancellation and balances from the main dashboard contract", () => {
    expect(validateDashboard({ ...state, cancelAtPeriodEnd: true, includedCreditsBalance: 120, addonCreditsBalance: 200 })).toMatchObject({ cancelAtPeriodEnd: true, includedCreditsBalance: 120, addonCreditsBalance: 200 });
  });
  it("rejects malformed account state and unsafe payment URLs", () => {
    expect(() => validateDashboard({ ...state, billingCycle: "annual" })).toThrow();
    expect(() => secureBillingUrl("javascript:alert(1)")).toThrow();
    expect(() => secureBillingUrl("https://user:pass@stripe.com")).toThrow();
  });
});
