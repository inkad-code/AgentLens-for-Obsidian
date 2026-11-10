import apiTargets from "../../api-targets.json";

export type BillingPlan = "basic" | "pro" | "ultra" | "mega";
export type BillingCycle = "monthly" | "yearly";
export type PaymentMethod = "card" | "wallet";
export interface BillingPlanConfig { plan: BillingPlan; priceMonthly: number; priceYearly: number; creditsLimit: number; active: boolean }
export interface BillingDashboard {
  plan: BillingPlan;
  billingCycle: BillingCycle;
  subscriptionStatus: string;
  scheduledPlan: BillingPlan | null;
  scheduledBillingCycle: BillingCycle | null;
  scheduledEffectiveAt: string | null;
  checkoutStatus: string | null;
  fetchReason: string | null;
  subscriptionTermEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  includedCreditsBalance?: number;
  addonCreditsBalance?: number;
  oneTimePurchase?: boolean;
}
export interface PurchaseSelection { itemType: "subscription" | "addon"; plan?: BillingPlan; billingCycle?: BillingCycle; addonCredits?: number }
export interface PurchaseIntent { id: string; displayedAmount: number; currency: string; checkoutStatus: string }
export interface BillingChange { status: string; invoiceUrl: string | null; effectiveAt: string | null }
export interface BillingPort {
  plans(): Promise<BillingPlanConfig[]>;
  dashboard(): Promise<BillingDashboard>;
  createIntent(selection: PurchaseSelection): Promise<PurchaseIntent>;
  intent(id: string): Promise<PurchaseIntent>;
  paymentOptions?(plan: BillingPlan, cycle: BillingCycle): Promise<{ walletAvailable: boolean }>;
  pendingCheckout?(): Promise<PendingCheckout | null>;
  checkout(id: string, paymentMethod?: PaymentMethod, confirmation?: CheckoutConfirmation): Promise<{ checkoutUrl: string; status: string }>;
  change(action: "upgrade" | "schedule-change", plan: BillingPlan, billingCycle: BillingCycle): Promise<BillingChange>;
  portal(): Promise<{ portalUrl: string }>;
  subscription(action: "cancel-at-period-end" | "cancel-scheduled-change" | "resume"): Promise<void>;
}

export function billingAction(dashboard: BillingDashboard, plan: BillingPlan, cycle: BillingCycle) {
  const active = hasActiveSubscription(dashboard);
  if (!active) return plan === "basic" ? "unavailable" : "checkout";
  if (dashboard.scheduledPlan === plan && dashboard.scheduledBillingCycle === cycle) return "scheduled";
  if (dashboard.plan === plan && dashboard.billingCycle === cycle) return "current";
  if (dashboard.oneTimePurchase) return "unavailable";
  if (dashboard.plan === "basic") return plan === "basic" ? "current" : "checkout";
  const rank = (value: BillingPlan) => ["basic", "pro", "ultra", "mega"].indexOf(value);
  const upgrade = (rank(plan) > rank(dashboard.plan) && cycle === dashboard.billingCycle)
    || (dashboard.billingCycle === "monthly" && cycle === "yearly" && rank(plan) >= rank(dashboard.plan));
  return upgrade ? "upgrade" : "schedule-change";
}
export function hasActiveSubscription(dashboard: BillingDashboard) {
  return ["active", "trialing"].includes(dashboard.subscriptionStatus)
    && !["SUBSCRIPTION_REQUIRED", "SUBSCRIPTION_EXPIRED"].includes(dashboard.fetchReason ?? "");
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid billing response.");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid billing field.");
  return value;
}
export function nullableText(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : text(value);
}
function amount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid billing amount.");
  return value;
}
function plan(value: unknown): BillingPlan {
  if (!["basic", "pro", "ultra", "mega"].includes(text(value))) throw new Error("Invalid billing plan.");
  return value as BillingPlan;
}
function cycle(value: unknown): BillingCycle {
  if (value !== "monthly" && value !== "yearly") throw new Error("Invalid billing cycle.");
  return value;
}
export function validatePlans(value: unknown): BillingPlanConfig[] {
  if (!Array.isArray(value)) throw new Error("Invalid plans response.");
  return value.map(item => {
    const data = record(item);
    if (typeof data.active !== "boolean") throw new Error("Invalid plan availability.");
    return { plan: plan(data.plan), priceMonthly: amount(data.priceMonthly), priceYearly: amount(data.priceYearly), creditsLimit: amount(data.creditsLimit), active: data.active };
  });
}
export function validateDashboard(value: unknown): BillingDashboard {
  const data = record(value);
  return {
    plan: plan(data.plan), billingCycle: cycle(data.billingCycle), subscriptionStatus: text(data.subscriptionStatus),
    scheduledPlan: data.scheduledPlan == null ? null : plan(data.scheduledPlan),
    scheduledBillingCycle: data.scheduledBillingCycle == null ? null : cycle(data.scheduledBillingCycle),
    scheduledEffectiveAt: nullableText(data.scheduledEffectiveAt), checkoutStatus: nullableText(data.checkoutStatus),
    subscriptionTermEndsAt: nullableText(data.subscriptionTermEndsAt),
    cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
    oneTimePurchase: data.oneTimePurchase === true,
    ...(data.includedCreditsBalance == null ? {} : { includedCreditsBalance: amount(data.includedCreditsBalance) }),
    ...(data.addonCreditsBalance == null ? {} : { addonCreditsBalance: amount(data.addonCreditsBalance) }),
    fetchReason: data.entitlement == null ? null : nullableText(record(record(data.entitlement).fetchEligibility).reason)
  };
}
export function validateIntent(value: unknown): PurchaseIntent {
  const data = record(value);
  return { id: text(data.id), displayedAmount: amount(data.displayedAmount), currency: text(data.currency), checkoutStatus: text(data.checkoutStatus) };
}
export function validateChange(value: unknown): BillingChange {
  const data = record(value);
  const invoiceUrl = nullableText(data.invoiceUrl);
  return { status: text(data.status), invoiceUrl: invoiceUrl ? secureBillingUrl(invoiceUrl, "invoice") : null, effectiveAt: nullableText(data.effectiveAt) };
}

const billingOrigins = {
  checkout: "https://checkout.stripe.com",
  invoice: "https://invoice.stripe.com",
  portal: "https://billing.stripe.com"
} as const;
export function secureBillingUrl(value: unknown, purpose: keyof typeof billingOrigins): string {
  const url = new URL(text(value));
  const checkoutFallback = purpose === "checkout" && url.pathname === "/dashboard/plan-billing"
    && url.origin === new URL(process.env.AGENTLENS_API_BASE_URL ?? apiTargets.production).origin;
  if (url.protocol !== "https:" || url.username || url.password || (url.origin !== billingOrigins[purpose] && !checkoutFallback)) {
    throw new Error("Invalid billing URL.");
  }
  return url.toString();
}


export interface CheckoutConfirmation { requestKey: string; replacesOrderId?: string; confirmed?: boolean; confirmedAmount?: number; currency?: string }
export interface CheckoutReplacement { oldOrderId: string; intentId: string; plan: BillingPlan; billingCycle: BillingCycle; paymentMethod: PaymentMethod; amount: number; currency: string; requestKey: string }
export interface PendingCheckout { intentId: string; plan: BillingPlan; billingCycle: BillingCycle; paymentMethod: PaymentMethod; amount: number; currency: string; requestKey: string }
export function validatePendingCheckout(value: unknown): PendingCheckout | null {
  const data = record(value).pending;
  if (data == null) return null;
  const item = record(data);
  if (item.paymentMethod !== "card" && item.paymentMethod !== "wallet") throw new Error("Invalid payment method.");
  return { intentId: text(item.intentId), plan: plan(item.plan), billingCycle: cycle(item.billingCycle), paymentMethod: item.paymentMethod, amount: amount(item.amount), currency: text(item.currency), requestKey: text(item.requestKey) };
}
export function checkoutReplacement(value: unknown, intent: PurchaseIntent, selection: PurchaseSelection, method?: PaymentMethod): CheckoutReplacement {
  const item = record(value);
  if (item.intentId !== intent.id || item.plan !== selection.plan || item.billingCycle !== selection.billingCycle
      || item.paymentMethod !== (method ?? "card") || item.amount !== intent.displayedAmount || item.currency !== intent.currency)
    throw new Error("The checkout selection changed. Review it before continuing.");
  return { oldOrderId: text(item.oldOrderId), intentId: intent.id, plan: plan(item.plan), billingCycle: cycle(item.billingCycle), paymentMethod: method ?? "card", amount: amount(item.amount), currency: text(item.currency), requestKey: text(item.requestKey) };
}
export function replacementDescription(replacement: CheckoutReplacement): string {
  const planName = replacement.plan[0]!.toUpperCase() + replacement.plan.slice(1);
  const period = replacement.billingCycle === "yearly" ? "year" : "month";
  const currency = replacement.currency === "USD" ? "US$" : `${replacement.currency} `;
  const price = currency + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(replacement.amount);
  const terms = replacement.paymentMethod === "wallet"
    ? ` for one ${period} · No automatic renewal`
    : `/${period} subscription · Renews automatically`;
  return `New order: ${planName} - ${price}${terms}`;
}
