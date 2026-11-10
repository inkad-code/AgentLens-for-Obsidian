import { useEffect, useRef, useState } from "react";
import { checkoutReplacement, replacementDescription, type CheckoutConfirmation, type CheckoutReplacement, billingAction, hasActiveSubscription, secureBillingUrl, type PaymentMethod, type BillingDashboard, type BillingPlanConfig, type BillingPort, type PurchaseIntent, type PurchaseSelection } from "../../api/billing";
import { useHostWindow } from "./HostDocument";
import { systemBrowserOpener } from "./useWorkbenchSession";
import { AgentLensError } from "../../core/errors";

interface ReplacementConfirmation { selection: PurchaseSelection; intent: PurchaseIntent; paymentMethod: PaymentMethod; details: CheckoutReplacement }
interface PendingPurchase { checkoutConfirmation?: CheckoutConfirmation; selection: PurchaseSelection; action: "checkout" | "upgrade"; intentId: string | null; url: string | null; amount?: number; currency?: string; paymentMethod?: PaymentMethod | undefined }
type BillingActivity = PaymentMethod | "billing";
const pendingPurchases = new WeakMap<BillingPort, Map<string, PendingPurchase>>();
export function useBilling(billing: BillingPort | undefined, accountId: string, onAccountChanged?: () => Promise<void>) {
  const window = useHostWindow();
  const [catalog, setCatalog] = useState<BillingPlanConfig[] | null>(null);
  const [dashboard, setDashboard] = useState<BillingDashboard | null>(null);
  const [activity, setActivity] = useState<BillingActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"cancel-at-period-end" | ReplacementConfirmation | null>(null);
  const [pending, setPending] = useState<PendingPurchase | null>(billing ? pendingPurchases.get(billing)?.get(accountId) ?? null : null);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [success, setSuccess] = useState<PurchaseSelection["itemType"] | null>(null);
  const active = useRef(false);
  const currentAccount = useRef(accountId); currentAccount.current = accountId;
  const currentBilling = useRef(billing); currentBilling.current = billing;
  const isCurrent = () => active.current && currentAccount.current === accountId && currentBilling.current === billing;
  const locked = useRef(false);
  const refreshAccount = useRef(onAccountChanged);
  refreshAccount.current = onAccountChanged;
  const report = (cause: unknown) => {
    const errors: Record<string,string> = {
      PAYMENT_METHOD_LOCKED: "A checkout is already open with another payment method. Complete it or wait for it to expire before switching.",
      WALLET_CHECKOUT_UNAVAILABLE: "Alipay / WeChat Pay is not available for this plan yet. Choose Credit Card or contact Support.",
      STRIPE_PRICE_MISMATCH: "This payment option is temporarily unavailable. Contact Support before paying.",
      ONE_TIME_PLAN: "Your plan does not renew automatically. You can purchase again after it expires."
    };
    setError(cause instanceof AgentLensError && cause.serverCode && errors[cause.serverCode] || (cause instanceof Error ? cause.message : "Could not contact billing. Please try again."));
  };
  function savePending(value: PendingPurchase | null) {
    if (billing) {
      let purchases = pendingPurchases.get(billing);
      if (!purchases) { purchases = new Map(); pendingPurchases.set(billing, purchases); }
      if (value) purchases.set(accountId, value); else purchases.delete(accountId);
    }
    if (isCurrent()) setPending(value);
  }
  async function run(action: () => Promise<void>, nextActivity: BillingActivity | null = "billing") {
    if (locked.current || !billing) return;
    locked.current = true;
    if (nextActivity) { setActivity(nextActivity); setError(null); }
    try { await action(); } catch (cause) { if (isCurrent() && nextActivity) report(cause); }
    finally { if (isCurrent()) { locked.current = false; if (nextActivity) setActivity(null); } }
  }
  async function load() {
    if (!billing) return;
    const [plans, state] = await Promise.all([billing.plans(), billing.dashboard()]);
    if (isCurrent()) { setCatalog(plans); setDashboard(state); }
    if (isCurrent() && accountId && billing.pendingCheckout && !pendingPurchases.get(billing)?.has(accountId)) {
      const recovery = await billing.pendingCheckout();
      if (recovery && isCurrent()) savePending({ selection: { itemType: "subscription", plan: recovery.plan, billingCycle: recovery.billingCycle }, action: "checkout", intentId: recovery.intentId, paymentMethod: recovery.paymentMethod, url: null, amount: recovery.amount, currency: recovery.currency, checkoutConfirmation: { requestKey: recovery.requestKey } });
    }
  }
  useEffect(() => {
    active.current = true; locked.current = false;
    void run(load);
    return () => { active.current = false; };
  }, [billing, accountId]);

  async function check(automatic = false, isCurrent = () => true) {
    if (!billing || !pending) return;
    let intent: PurchaseIntent | null;
    let state: BillingDashboard;
    try {
      // Read the order first; the account snapshot must follow its committed payment.
      intent = pending.intentId ? await billing.intent(pending.intentId) : null;
      if (!isCurrent() || !isCurrent()) return;
      state = await billing.dashboard();
    } catch (cause) {
      if (cause instanceof AgentLensError && cause.serverCode === "PURCHASE_INTENT_EXPIRED") {
        if (!isCurrent() || !isCurrent()) return;
        savePending(null);
        setNotice("This payment link has expired. Check Manage billing for the original payment before purchasing again.");
        await load(); await refreshAccount.current?.(); return;
      }
      throw cause;
    }
    if (!isCurrent() || !isCurrent()) return;
    setDashboard(state);
    const entitlementApplied = pending.selection.itemType === "addon" || (state.plan === pending.selection.plan && state.billingCycle === pending.selection.billingCycle
      && hasActiveSubscription(state) && state.checkoutStatus !== "payment_pending");
    const terminalFailure = Boolean(intent && ["expired", "failed", "refunded"].includes(intent.checkoutStatus));
    const paid = !terminalFailure && entitlementApplied && (pending.action === "upgrade" || intent?.checkoutStatus === "paid");
    if (paid) {
      await refreshAccount.current?.();
      if (!isCurrent() || !isCurrent()) return;
      savePending(null); setNotice(null); setSuccess(pending.selection.itemType);
    } else if (intent && ["expired", "failed", "refunded"].includes(intent.checkoutStatus)) {
      savePending(null); setNotice(`Payment ${intent.checkoutStatus}. You can choose a plan again.`);
      await refreshAccount.current?.();
    } else if (!automatic) setNotice("Waiting for payment confirmation. You can check again after completing payment.");
  }
  useEffect(() => {
    if (!billing || !pending) return;
    const document = window.document;
    let stopped = false;
    let timer: number | undefined;
    const checkPayment = () => {
      timer = undefined;
      if (stopped || document.visibilityState === "hidden") return;
      // Checkout, manual checks and polling share one lock; never overlap requests.
      if (locked.current) { timer = window.setTimeout(checkPayment, 250); return; }
      void run(() => check(true, () => !stopped), null);
    };
    const scheduleCheck = () => {
      if (stopped || document.visibilityState === "hidden") return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(checkPayment, 250);
    };
    const interval = window.setInterval(() => {
      if (timer === undefined) checkPayment();
    }, 3000);
    timer = window.setTimeout(checkPayment, 0);
    window.addEventListener("focus", scheduleCheck);
    document.addEventListener("visibilitychange", scheduleCheck);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("focus", scheduleCheck);
      document.removeEventListener("visibilitychange", scheduleCheck);
    };
  }, [billing, accountId, pending, window]);
  const prepare = (selection: PurchaseSelection, paymentMethod?: PaymentMethod) => {
    if (!billing || locked.current) return Promise.resolve();
    const opener = systemBrowserOpener();
    const initialAction = selection.itemType === "addon" ? "checkout" : dashboard ? billingAction(dashboard, selection.plan!, selection.billingCycle!) : null;
    const annualBlocked = initialAction === "upgrade" && dashboard?.billingCycle === "yearly" && selection.billingCycle === "yearly";
    if (annualBlocked) return Promise.resolve();
    const tab = !opener && (initialAction === "checkout" || initialAction === "upgrade") ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    return run(async () => {
    try {
    if (!billing) return;
    const state = await billing.dashboard();
    if (!isCurrent()) return;
    setDashboard(state); setNotice(null);
    const action = selection.itemType === "addon" ? "checkout" : billingAction(state, selection.plan!, selection.billingCycle!);
    if (paymentMethod === "wallet") {
      if (action !== "checkout" || selection.itemType !== "subscription" || !billing.paymentOptions) throw new Error("Alipay / WeChat Pay is unavailable for this selection.");
      if (!(await billing.paymentOptions(selection.plan!, selection.billingCycle!)).walletAvailable) throw new Error("Alipay / WeChat Pay is not available for this plan yet. Choose Credit Card or contact Support.");
      if (!isCurrent()) { tab?.close(); return; }
    }
    if (selection.itemType === "addon" && !hasActiveSubscription(state)) throw new Error("An active plan is required before adding credits.");
    if (!["checkout", "upgrade", "schedule-change"].includes(action)) throw new Error("This selection is already active, scheduled, or unavailable.");
    if (selection.itemType === "subscription" && selection.plan === "basic") {
      tab?.close();
      setConfirmation("cancel-at-period-end");
      return;
    }
    if (action === "upgrade" && state.billingCycle === "yearly" && selection.billingCycle === "yearly") throw new Error("The credit for unused subscription time isn't available for this upgrade yet. No payment will be started. Contact Support for help.");
    if (action === "schedule-change") {
      tab?.close();
      const result = await billing.change(action, selection.plan!, selection.billingCycle!);
      if (!isCurrent()) return;
      setNotice(`Plan change scheduled${result.effectiveAt ? ` for ${new Date(result.effectiveAt).toLocaleDateString()}` : " at the end of your current term"}.`);
      await load(); await refreshAccount.current?.(); return;
    }
    const intent = await billing.createIntent(selection);
    await startPayment(selection, intent, action as "checkout" | "upgrade", opener, tab, paymentMethod);
    } catch (cause) { tab?.close(); throw cause; }
    }, paymentMethod ?? "card");
  };

  async function startPayment(selection: PurchaseSelection, intent: PurchaseIntent, action: "checkout" | "upgrade", opener: ReturnType<typeof systemBrowserOpener>, tab: Window | null, paymentMethod?: PaymentMethod, checkoutConfirmation?: CheckoutConfirmation) {
    if (!billing) return;
    const previousPending = pending;
    // Retain the original order if the checkout response is lost.
    const purchase: PendingPurchase = { ...(checkoutConfirmation ? { checkoutConfirmation } : {}), selection, action, intentId: intent.id, url: null, paymentMethod };
    savePending(purchase);
    if (!isCurrent()) { tab?.close(); return; }
    if (isCurrent()) { setConfirmation(null); setPendingOpen(false); }
    try {
      let url = action === "checkout" ? (await (checkoutConfirmation ? billing.checkout(intent.id, paymentMethod, checkoutConfirmation) : paymentMethod ? billing.checkout(intent.id, paymentMethod) : billing.checkout(intent.id))).checkoutUrl : (await billing.change(action, selection.plan!, selection.billingCycle!)).invoiceUrl;
      if (url) url = secureBillingUrl(url, action === "checkout" ? "checkout" : "invoice");
      savePending({ ...purchase, url });
      if (url && isCurrent()) {
        if (opener) await opener(url);
        else if (tab && !tab.closed) tab.location.replace(url);
        else throw new Error("Could not open checkout. Use Reopen checkout to try again.");
      } else {
        tab?.close();
        if (isCurrent()) throw new Error("The payment link is unavailable. Use Reopen checkout to try again.");
      }
      if (isCurrent()) { setNotice(null); setPendingOpen(true); }
    } catch (cause) {
      tab?.close();
      if (cause instanceof AgentLensError && cause.serverCode === "PAYMENT_PENDING" && billing.pendingCheckout) {
        try {
          const recovery = await billing.pendingCheckout();
          if (recovery && isCurrent() && recovery.intentId !== intent.id) {
            savePending({ selection: { itemType: "subscription", plan: recovery.plan, billingCycle: recovery.billingCycle }, action: "checkout", intentId: recovery.intentId, paymentMethod: recovery.paymentMethod, url: null, amount: recovery.amount, currency: recovery.currency, checkoutConfirmation: { requestKey: recovery.requestKey } });
            setPendingOpen(true);
          }
        } catch { /* Preserve the original reconciliation error if its read-back is unavailable. */ }
      }
      if (cause instanceof AgentLensError && cause.serverCode === "CHECKOUT_REPLACEMENT_REQUIRED" && action === "checkout") {
        const details = checkoutReplacement(cause.details, intent, selection, paymentMethod);
        savePending(previousPending); setPendingOpen(false); setConfirmation({ selection, intent, paymentMethod: details.paymentMethod, details });
        return;
      }
      // The server already chose a method. Reopen that checkout without switching it.
      if (cause instanceof AgentLensError && cause.serverCode === "PAYMENT_METHOD_LOCKED") savePending({ ...purchase, paymentMethod: undefined });
      if (cause instanceof AgentLensError && cause.status && cause.status >= 400 && cause.status < 500 && cause.serverCode !== "PAYMENT_PENDING" && cause.serverCode !== "PAYMENT_METHOD_LOCKED" && cause.serverCode !== "STRIPE_PRICE_MISMATCH") savePending(null);
      throw cause;
    }
  }

  const confirm = () => {
    if (!confirmation || !billing || locked.current) return Promise.resolve();
    return run(async () => {
      if (typeof confirmation === "object") {
        const replacement = confirmation;
        const opener = systemBrowserOpener();
        const tab = !opener ? window.open("about:blank", "_blank") : null;
        if (tab) tab.opener = null;
        await startPayment(replacement.selection, replacement.intent, "checkout", opener, tab, replacement.paymentMethod,
          { requestKey: replacement.details.requestKey, replacesOrderId: replacement.details.oldOrderId, confirmed: true, confirmedAmount: replacement.details.amount, currency: replacement.details.currency });
        return;
      }
      await billing.subscription(confirmation);
      if (!isCurrent()) return;
      setConfirmation(null); setNotice("Renewal canceled. Your current plan remains active until the end of the subscription term.");
      await load(); await refreshAccount.current?.();
    });
  };
  const reopen = () => run(async () => {
    if (!billing || !pending) return;
    let url = pending.url;
    if (!url) {
      if (pending.action === "upgrade") throw new Error("The original invoice link is unavailable. Open Manage billing to review the pending payment.");
      url = (await (pending.checkoutConfirmation ? billing.checkout(pending.intentId!, pending.paymentMethod, pending.checkoutConfirmation) : pending.paymentMethod ? billing.checkout(pending.intentId!, pending.paymentMethod) : billing.checkout(pending.intentId!))).checkoutUrl;
    }
    url = secureBillingUrl(url, pending.action === "checkout" ? "checkout" : "invoice");
    savePending({ ...pending, url });
    if (!isCurrent()) return;
    const opener = systemBrowserOpener();
    if (opener) await opener(url);
    else if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Allow browser pop-ups to open the payment page.");
  });
  const manage = () => run(async () => {
    if (!billing) return;
    const url = secureBillingUrl((await billing.portal()).portalUrl, "portal");
    if (!isCurrent()) return;
    const opener = systemBrowserOpener();
    if (opener) await opener(url);
    else if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Allow browser pop-ups to open billing.");
  });
  const keepCurrent = () => run(async () => {
    if (!billing || !dashboard) return;
    await billing.subscription(dashboard.cancelAtPeriodEnd ? "resume" : "cancel-scheduled-change");
    if (!isCurrent()) return;
    setNotice(`${dashboard.plan[0]!.toUpperCase()}${dashboard.plan.slice(1)} will remain your current plan.`);
    await load(); await refreshAccount.current?.();
  });
  return { replacementDescription: typeof confirmation === "object" && confirmation ? replacementDescription(confirmation.details) : null, catalog, dashboard, busy: activity !== null, activity, error, notice, pending, pendingOpen, success, confirmation, prepare, confirm, cancel: () => { if (typeof confirmation !== "object" || confirmation === null) savePending(null); setConfirmation(null); setPendingOpen(false); setSuccess(null); setNotice(null); setError(null); }, showPending: () => setPendingOpen(true), keepCurrent, check: () => run(() => check()), reopen, manage, reload: () => run(async () => { await load(); await refreshAccount.current?.(); }) };
}
