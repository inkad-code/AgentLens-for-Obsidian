export type BillingPlan = "basic" | "pro" | "ultra" | "mega";
export type BillingCycle = "monthly" | "yearly";
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
}
export interface PurchaseSelection { itemType: "subscription" | "addon"; plan?: BillingPlan; billingCycle?: BillingCycle; addonCredits?: number }
export interface PurchaseIntent { id: string; displayedAmount: number; currency: string; checkoutStatus: string }
export interface BillingChange { status: string; invoiceUrl: string | null; effectiveAt: string | null }
export interface BillingPort {
  plans(): Promise<BillingPlanConfig[]>;
  dashboard(): Promise<BillingDashboard>;
  createIntent(selection: PurchaseSelection): Promise<PurchaseIntent>;
  intent(id: string): Promise<PurchaseIntent>;
  checkout(id: string): Promise<{ checkoutUrl: string; status: string }>;
  change(action: "upgrade" | "schedule-change", plan: BillingPlan, billingCycle: BillingCycle): Promise<BillingChange>;
  portal(): Promise<{ portalUrl: string }>;
  subscription(action: "cancel-at-period-end" | "cancel-scheduled-change" | "resume"): Promise<void>;
}

export function billingAction(dashboard: BillingDashboard, plan: BillingPlan, cycle: BillingCycle) {
  const active = hasActiveSubscription(dashboard);
  if (!active) return plan === "basic" ? "unavailable" : "checkout";
  if (dashboard.scheduledPlan === plan && dashboard.scheduledBillingCycle === cycle) return "scheduled";
  if (dashboard.plan === plan && dashboard.billingCycle === cycle) return "current";
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
  return { status: text(data.status), invoiceUrl: nullableText(data.invoiceUrl), effectiveAt: nullableText(data.effectiveAt) };
}
export function secureBillingUrl(value: unknown): string {
  const url = new URL(text(value));
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid billing URL.");
  return url.toString();
}
