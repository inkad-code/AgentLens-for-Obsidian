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
  monthlyCreditPeriodEndsAt?: string | null;
  quotaRefreshAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  includedCreditsBalance?: number;
  addonCreditsBalance?: number;
  oneTimePurchase?: boolean;
}
export interface PurchaseSelection { itemType: "subscription" | "addon"; plan?: BillingPlan; billingCycle?: BillingCycle; addonCredits?: number }
export interface PurchaseIntent { id: string; displayedAmount: number; currency: string; checkoutStatus: string }
export interface BillingChange { status: string; invoiceUrl: string | null; effectiveAt: string | null }
export interface LifecycleAction { replacesAuthorization?: boolean | null; summary?: string | null; impactDescription?: string | null; amountMinor?: number | null; replacesIntentId?: string | null; resumeIntentId?: string | null; futureId?: string | null; plan: "BASIC" | "PRO" | "ULTRA" | "MEGA"; mode: "BASIC" | "AM" | "AY" | "OM" | "OY"; action: string; enabled: boolean; reason: string; stateVersion: number; description?: string }
export interface LifecyclePending { action?: string; intentId: string; plan: BillingPlan; billingCycle: BillingCycle; mode: "BASIC" | "AM" | "AY" | "OM" | "OY"; amount: number; currency: string; state: string }
export interface LifecycleState {
  stateVersion: number;
  future: null | { id: string; kind?: string; state: string; plan: string; mode: string; effectiveAt: string; cancelAvailable?: boolean; paidAmount?: number; currency?: string };
  renewal: null | { plan: string; mode: string; periodEnd: string; canceled: boolean; restoreAvailable?: boolean };
}
export interface LifecycleCheckout { state: string; checkoutUrl: string | null }
export interface BillingPort {
  lifecycleState?(): Promise<LifecycleState>;
  lifecycleRestoreRenewal?(confirmation: {stateVersion:number;requestKey:string;futureId:string|null;confirmed:true}): Promise<{status:string}>;
  lifecycleCancelFuture?(id:string,stateVersion:number): Promise<{status:string}>;
  lifecyclePending?(): Promise<LifecyclePending | null>;
  lifecycleActions?(): Promise<LifecycleAction[] | null>;
  lifecycleCheckout?(intentId: string, action: LifecycleAction): Promise<LifecycleCheckout>;
  lifecycleResume?(intentId: string): Promise<LifecycleCheckout>;
  lifecycleReconcile?(intentId: string): Promise<{status: string}>;
  plans(): Promise<BillingPlanConfig[]>;
  dashboard(): Promise<BillingDashboard>;
  createIntent(selection: PurchaseSelection): Promise<PurchaseIntent>;
  intent(id: string): Promise<PurchaseIntent>;
  paymentOptions?(plan: BillingPlan, cycle: BillingCycle): Promise<{ walletAvailable: boolean }>;
  pendingCheckout?(): Promise<PendingCheckout | null>;
  checkout(id: string, paymentMethod?: PaymentMethod, confirmation?: CheckoutConfirmation): Promise<{ checkoutUrl: string; status: string }>;
  change(action: "upgrade" | "schedule-change", plan: BillingPlan, billingCycle: BillingCycle): Promise<BillingChange>;
  portal(lifecycle?: boolean): Promise<{ portalUrl: string }>;
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
    monthlyCreditPeriodEndsAt: nullableText(data.monthlyCreditPeriodEndsAt),
    quotaRefreshAt: nullableText(data.quotaRefreshAt),
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
  portal: "https://billing.stripe.com",
  lifecycleCheckout: "https://checkout.stripe.com",
  lifecyclePortal: "https://billing.stripe.com"
} as const;
export function secureBillingUrl(value: unknown, purpose: keyof typeof billingOrigins): string {
  const url = new URL(text(value));
  const checkoutFallback = ["checkout", "lifecyclePortal"].includes(purpose) && url.pathname === "/dashboard/plan-billing"
    && url.origin === new URL(process.env.AGENTLENS_API_BASE_URL ?? apiTargets.production).origin;
  const wechatInstructions = purpose === "lifecycleCheckout"
    && url.origin === "https://payments.stripe.com" && url.pathname.startsWith("/wechat_pay/instructions/");
  if (url.protocol !== "https:" || url.username || url.password || (url.origin !== billingOrigins[purpose] && !checkoutFallback && !wechatInstructions)) {
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
export function checkoutReplacementCopy(
  replacement: Pick<CheckoutReplacement, "plan" | "billingCycle" | "currency" | "paymentMethod"> & { amount: number | null },
) {
  const planName = replacement.plan[0]!.toUpperCase() + replacement.plan.slice(1);
  const period = replacement.billingCycle === "yearly" ? "year" : "month";
  const currency = replacement.currency === "USD" ? "US$" : `${replacement.currency} `;
  const price = replacement.amount == null ? null : currency + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(replacement.amount);
  const label = price == null ? planName : `${planName} - ${price}`;
  return replacement.paymentMethod === "wallet"
    ? { headline: `${label} for one ${period}`, terms: " · No automatic renewal" }
    : { headline: price == null ? `${label} ${period === "year" ? "annual" : "monthly"}` : `${label}/${period}`, terms: " subscription. Renews automatically" };
}

// These adapters validate the server contract; they do not derive billing eligibility locally.
export function validateLifecycleActions(value: unknown): LifecycleAction[] {
  if (!Array.isArray(value) || value.length !== 13) throw new Error("Invalid billing actions.");
  const keys = new Set<string>();
  return value.map(item => {
    const data = record(item);
    if (!["BASIC", "PRO", "ULTRA", "MEGA"].includes(String(data.plan))
      || !["BASIC", "AM", "AY", "OM", "OY"].includes(String(data.mode))
      || (data.plan === "BASIC") !== (data.mode === "BASIC")
      || typeof data.enabled !== "boolean" || typeof data.reason !== "string"
      || !Number.isSafeInteger(data.stateVersion) || Number(data.stateVersion) < 0
      || !["CURRENT", "NEW", "UP_M", "UP_Y", "SCHEDULE", "PREPAY", "DOWN_O", "BLOCK_AO", "CANCEL_A", "BLOCK_OB", "RESUME", "REVIEW"].includes(String(data.action)))
      throw new Error("Invalid billing action.");
    const key = `${String(data.plan)}:${String(data.mode)}`;
    if (keys.has(key)) throw new Error("Duplicate billing action."); keys.add(key);
    for (const field of ["summary", "impactDescription"]) if (data[field] != null && typeof data[field] !== "string") throw new Error("Invalid billing copy.");
    if (data.description !== undefined && typeof data.description !== "string") throw new Error("Invalid billing description.");
    if (data.futureId !== undefined && data.futureId !== null && (typeof data.futureId !== "string" || !data.futureId)) throw new Error("Invalid future confirmation.");
    if (data.amountMinor != null && (!Number.isSafeInteger(data.amountMinor) || Number(data.amountMinor)<0)) throw new Error("Invalid billing amount.");
    if (data.replacesAuthorization != null && (typeof data.replacesAuthorization !== "boolean"
        || (data.replacesAuthorization && !data.replacesIntentId))) throw new Error("Invalid authorization replacement.");
    for (const field of ["replacesIntentId", "resumeIntentId"]) {
      if (data[field] != null && (typeof data[field] !== "string" || !data[field])) throw new Error("Invalid checkout reference.");
    }
    return data as unknown as LifecycleAction;
  });
}
export function validateLifecycleCheckout(value: unknown): LifecycleCheckout {
  const data = record(value);
  return {state: text(data.state), checkoutUrl: data.checkoutUrl == null ? null : secureBillingUrl(data.checkoutUrl, "lifecycleCheckout")};
}
export function lifecycleSelection(actions: LifecycleAction[], selection: PurchaseSelection, method: PaymentMethod = "card") {
  const mode = selection.plan === "basic" ? "BASIC" : method === "wallet"
    ? selection.billingCycle === "yearly" ? "OY" : "OM" : selection.billingCycle === "yearly" ? "AY" : "AM";
  return actions.find(action => action.plan.toLowerCase() === selection.plan && action.mode === mode);
}

/** Presentation only. Eligibility and business actions come from the authenticated server. */
export function lifecycleReason(reason: string | undefined): string {
  const messages: Record<string, string> = {
    CURRENT: 'This is your current plan.',
    RENEWAL_ALREADY_CANCELED: 'Your automatic renewal is already canceled; paid coverage remains until its original expiry.',
    CANCEL_EXISTING_RESERVATION_FIRST: 'Cancel the unpaid reservation in Manage billing, then review the original renewal.',
    ORIGINAL_BINDING_REQUIRES_REVIEW: 'The original renewal needs verification. Contact Support.',
    CURRENT_RESERVATION: 'This is already your reserved automatic plan.',
    SCHEDULE_RECONCILIATION_REQUIRED: 'Check the original reservation before making another change.',
    FUTURE_RECONCILIATION_REQUIRED: 'Check the original future purchase before making another change.',

    BLOCK_AO: 'Your active automatic plan cannot switch to a one-time purchase at the same tier.',
    BLOCK_OB: 'Your one-time plan remains active until its expiry date.',
    REFRESH_REQUIRED: 'Your account changed. Refresh the available actions.',
    PAYMENT_RECONCILIATION: 'Continue or check your existing payment before starting another purchase.',
    RECOVERY_CHOICE_REQUIRED: 'Choose whether to recover the original renewal before making another purchase.',
    CANCEL_EXISTING_FUTURE_FIRST: 'Cancel your existing future purchase before choosing another future plan.',
    OLD_COLLECTION_REQUIRES_ORCHESTRATION: 'This change is temporarily unavailable while the existing renewal needs verification.',
    RESERVATIONS_PENDING: 'Usage is still settling. Refresh after it completes.',
    EXPIRY_RECONCILIATION_REQUIRED: 'Your plan has expired. Refresh after its final balance is reconciled.',
    GRANT_REVIEW_REQUIRED: 'Your account credits need review. Contact Support before changing plans.',
    LEGACY_ENROLLMENT_REQUIRED: 'Your current plan needs review before using this payment flow. Contact Support.',
    SUBMISSIONS_PAUSED: 'New billing changes are paused. Continue or check the original operation.',
    WORKFLOW_NOT_ENABLED: 'This payment option is not yet available. Choose an available option or contact Support.',
  };
  return reason ? messages[reason] ?? 'This action is temporarily unavailable. Refresh or contact Support.' : '';
}

export function validateLifecyclePending(value: unknown): LifecyclePending | null {
  const payload = record(value);
  if (payload.purchase === null) return null;
  const data = record(payload.purchase);
  if (!["BASIC", "AM", "AY", "OM", "OY"].includes(String(data.mode))) throw new Error("Invalid pending purchase mode.");
  return {...(data.action == null ? {} : {action:text(data.action)}),intentId: text(data.intentId), plan: plan(data.plan), billingCycle: cycle(data.billingCycle),
    mode: data.mode as LifecyclePending["mode"], amount: amount(data.amount), currency: text(data.currency), state: text(data.state)};
}

/** Read-only status from the existing lifecycle API; never determines eligibility. */
export function validateLifecycleState(value: unknown): LifecycleState {
  const data = record(value);
  if (!Number.isSafeInteger(data.stateVersion) || Number(data.stateVersion) < 0) throw new Error("Invalid billing state.");
  const mode = (value: unknown) => { const result = text(value); if (!["AM", "AY", "OM", "OY"].includes(result)) throw new Error("Invalid billing mode."); return result; };
  const date = (value: unknown) => { const result = text(value); if (!Number.isFinite(Date.parse(result))) throw new Error("Invalid billing date."); return result; };
  const tier = (value: unknown) => { const result = text(value); plan(result.toLowerCase()); return result; };
  let future: LifecycleState["future"] = null;
  if (data.future != null) {
    const f = record(data.future);
    if (f.kind != null && (typeof f.kind !== "string" || !["SCHEDULE", "ONE_OFF"].includes(f.kind))) throw new Error("Invalid future plan kind.");
    if (f.cancelAvailable != null && typeof f.cancelAvailable !== "boolean") throw new Error("Invalid cancellation state.");
    if (f.currency != null && (typeof f.currency !== "string" || !/^[A-Z]{3}$/.test(f.currency))) throw new Error("Invalid future currency.");
    future = {...(f.cancelAvailable == null ? {} : {cancelAvailable:f.cancelAvailable}), ...(f.paidAmount == null ? {} : {paidAmount:amount(f.paidAmount)}), ...(f.currency == null ? {} : {currency:text(f.currency)}), id:text(f.id), state:text(f.state), plan:tier(f.plan), mode:mode(f.mode), effectiveAt:date(f.effectiveAt), ...(f.kind == null ? {} : {kind:text(f.kind)})};
  }
  let renewal: LifecycleState["renewal"] = null;
  if (data.renewal != null) {
    const n = record(data.renewal);
    if (typeof n.canceled !== "boolean") throw new Error("Invalid renewal state.");
    if (n.restoreAvailable != null && typeof n.restoreAvailable !== "boolean") throw new Error("Invalid restoration state.");
    renewal = {...(n.restoreAvailable == null ? {} : {restoreAvailable:n.restoreAvailable}), plan:tier(n.plan), mode:mode(n.mode), periodEnd:date(n.periodEnd), canceled:n.canceled};
  }
  return {stateVersion:Number(data.stateVersion), future, renewal};
}
