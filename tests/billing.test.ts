import { describe, expect, it } from "vitest";
import { AgentLensApiClient } from "@/api/AgentLensApiClient";
import { billingAction, validateDashboard, secureBillingUrl, type BillingDashboard } from "@/api/billing";
import type { JsonTransport, TransportRequest } from "@/runtime/ObsidianRequestUrlTransport";

const state: BillingDashboard = { plan: "pro", billingCycle: "monthly", subscriptionStatus: "active", scheduledPlan: null, scheduledBillingCycle: null, scheduledEffectiveAt: null, checkoutStatus: null, fetchReason: null };
describe("deployed billing contract", () => {
  it("authenticates wallet availability and forwards the chosen payment method", async () => {
    const requests: TransportRequest[]=[];
    const responses: unknown[]=[{walletAvailable:true},{checkoutUrl:"https://checkout.stripe.com/wallet",status:"pending"},{checkoutUrl:"https://checkout.stripe.com/card",status:"pending"}];
    const transport: JsonTransport={json:async(request,validate)=>{requests.push(request);return validate(responses.shift());}};
    const api=new AgentLensApiClient(transport,{installationId:"i",deviceId:"d",clientVersion:"1",obsidianVersion:"1",platform:"desktop_windows"}).billing("token");
    expect(await api.paymentOptions!("ultra","yearly")).toEqual({walletAvailable:true});
    await api.checkout("intent-1","wallet");await api.checkout("intent-2","card");
    expect(requests).toEqual([
      {path:"/billing/payment-options?plan=ultra&billingCycle=yearly",accessToken:"token"},
      {path:"/billing/checkout",method:"POST",accessToken:"token",body:{intentId:"intent-1",paymentMethod:"wallet"}},
      {path:"/billing/checkout",method:"POST",accessToken:"token",body:{intentId:"intent-2",paymentMethod:"card"}}
    ]);
  });
  it("does not route an active one-time plan through recurring subscription changes", () => {
    const oneTime={...state,oneTimePurchase:true};
    expect(billingAction(oneTime,"pro","monthly")).toBe("current");
    expect(billingAction(oneTime,"ultra","monthly")).toBe("unavailable");
    expect(billingAction({...oneTime,fetchReason:"SUBSCRIPTION_EXPIRED"},"ultra","monthly")).toBe("checkout");
    expect(validateDashboard(oneTime).oneTimePurchase).toBe(true);
  });
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
    for (const url of [
      "javascript:alert(1)",
      "https://user:pass@checkout.stripe.com",
      "http://checkout.stripe.com/pay",
      "https://checkout.stripe.com.example.org/pay",
      "https://checkout.stripe.com:8443/pay",
      "https://other.agentlensapi.io/pay",
      "https://example.org/pay"
    ]) expect(() => secureBillingUrl(url, "checkout")).toThrow();
  });
  it("accepts Stripe links only for their intended billing purpose and preserves URL data", () => {
    const links = {
      checkout: "https://checkout.stripe.com/c/pay?locale=en#original%2Ffragment",
      invoice: "https://invoice.stripe.com/i/1",
      portal: "https://billing.stripe.com/p/session"
    } as const;
    const purposes = ["checkout", "invoice", "portal"] as const;
    for (const purpose of purposes) {
      expect(secureBillingUrl(links[purpose], purpose)).toBe(links[purpose]);
      for (const other of purposes.filter(candidate => candidate !== purpose)) {
        expect(() => secureBillingUrl(links[other], purpose)).toThrow();
      }
    }
    const fallback = "https://agentlensapi.io/dashboard/plan-billing?plan=pro&cycle=monthly";
    expect(secureBillingUrl(fallback, "checkout")).toBe(fallback);
    expect(() => secureBillingUrl(fallback, "portal")).toThrow();
    expect(() => secureBillingUrl("https://agentlensapi.io/other", "checkout")).toThrow();
  });
});
