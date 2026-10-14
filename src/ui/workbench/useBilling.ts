import { useEffect, useRef, useState } from "react";
import { billingAction, hasActiveSubscription, secureBillingUrl, type BillingDashboard, type BillingPlanConfig, type BillingPort, type PurchaseIntent, type PurchaseSelection } from "../../api/billing";
import { useHostWindow } from "./HostDocument";
import { systemBrowserOpener } from "./useWorkbenchSession";
import { AgentLensError } from "../../core/errors";

interface PendingPurchase { selection: PurchaseSelection; action: "checkout" | "upgrade"; intentId: string | null; url: string | null }
const pendingPurchases = new WeakMap<BillingPort, Map<string, PendingPurchase>>();
export function useBilling(billing: BillingPort | undefined, accountId: string, onAccountChanged?: () => Promise<void>) {
  const window = useHostWindow();
  const [catalog, setCatalog] = useState<BillingPlanConfig[] | null>(null);
  const [dashboard, setDashboard] = useState<BillingDashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"cancel-at-period-end" | null>(null);
  const [pending, setPending] = useState<PendingPurchase | null>(billing ? pendingPurchases.get(billing)?.get(accountId) ?? null : null);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [success, setSuccess] = useState<PurchaseSelection["itemType"] | null>(null);
  const active = useRef(false);
  const locked = useRef(false);
  const refreshAccount = useRef(onAccountChanged);
  refreshAccount.current = onAccountChanged;
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not contact billing. Please try again.");
  function savePending(value: PendingPurchase | null) {
    if (billing) {
      let purchases = pendingPurchases.get(billing);
      if (!purchases) { purchases = new Map(); pendingPurchases.set(billing, purchases); }
      if (value) purchases.set(accountId, value); else purchases.delete(accountId);
    }
    if (active.current) setPending(value);
  }
  async function run(action: () => Promise<void>, silent = false) {
    if (locked.current || !billing) return;
    locked.current = true;
    setBusy(true); if (!silent) setError(null);
    try { await action(); } catch (cause) { if (active.current && !silent) report(cause); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  async function load() {
    if (!billing) return;
    const [plans, state] = await Promise.all([billing.plans(), billing.dashboard()]);
    if (active.current) { setCatalog(plans); setDashboard(state); }
  }
  useEffect(() => {
    active.current = true;
    void run(load);
    return () => { active.current = false; };
  }, [billing, accountId]);

  async function check(automatic = false) {
    if (!billing || !pending) return;
    let intent: PurchaseIntent | null;
    let state: BillingDashboard;
    try {
      [intent, state] = await Promise.all([pending.intentId ? billing.intent(pending.intentId) : Promise.resolve(null), billing.dashboard()]);
    } catch (cause) {
      if (cause instanceof AgentLensError && cause.serverCode === "PURCHASE_INTENT_EXPIRED") {
        if (!active.current) return;
        savePending(null);
        setNotice("This payment link has expired. Check Manage billing for the original payment before purchasing again.");
        await load(); await refreshAccount.current?.(); return;
      }
      throw cause;
    }
    if (!active.current) return;
    setDashboard(state);
    const entitlementApplied = pending.selection.itemType === "addon" || (state.plan === pending.selection.plan && state.billingCycle === pending.selection.billingCycle
      && hasActiveSubscription(state) && state.checkoutStatus !== "payment_pending");
    const paid = entitlementApplied && (pending.action === "upgrade" || intent?.checkoutStatus === "paid");
    if (paid) {
      await refreshAccount.current?.();
      if (!active.current) return;
      savePending(null); setNotice(null); setSuccess(pending.selection.itemType);
    } else if (intent && ["expired", "failed", "refunded"].includes(intent.checkoutStatus)) {
      savePending(null); setNotice(`Payment ${intent.checkoutStatus}. You can choose a plan again.`);
      await refreshAccount.current?.();
    } else if (pending.action === "upgrade" && state.checkoutStatus !== "payment_pending") {
      savePending(null); setNotice("The upgrade has not been applied and no upgrade payment is pending. Check Manage billing or try again.");
      await refreshAccount.current?.();
    } else if (!automatic) setNotice("Waiting for payment confirmation. You can check again after completing payment.");
  }
  useEffect(() => {
    if (!billing || !pending) return;
    const document = window.document;
    let timer: number | undefined;
    let lastCheck = 0;
    const checkOnReturn = () => {
      timer = undefined;
      if (document.visibilityState === "hidden") return;
      // A return event can arrive before the browser-opening request finishes.
      if (locked.current) { timer = window.setTimeout(checkOnReturn, 250); return; }
      lastCheck = Date.now();
      void run(() => check(true), true);
    };
    const scheduleCheck = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastCheck < 1000) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(checkOnReturn, 250);
    };
    window.addEventListener("focus", scheduleCheck);
    document.addEventListener("visibilitychange", scheduleCheck);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", scheduleCheck);
      document.removeEventListener("visibilitychange", scheduleCheck);
    };
  }, [billing, accountId, pending, window]);
  const prepare = (selection: PurchaseSelection) => {
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
    if (!active.current) return;
    setDashboard(state); setNotice(null);
    const action = selection.itemType === "addon" ? "checkout" : billingAction(state, selection.plan!, selection.billingCycle!);
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
      if (!active.current) return;
      setNotice(`Plan change scheduled${result.effectiveAt ? ` for ${new Date(result.effectiveAt).toLocaleDateString()}` : " at the end of your current term"}.`);
      await load(); await refreshAccount.current?.(); return;
    }
    const intent = await billing.createIntent(selection);
    await startPayment(selection, intent, action as "checkout" | "upgrade", opener, tab);
    } catch (cause) { tab?.close(); throw cause; }
    });
  };

  async function startPayment(selection: PurchaseSelection, intent: PurchaseIntent, action: "checkout" | "upgrade", opener: ReturnType<typeof systemBrowserOpener>, tab: Window | null) {
    if (!billing) return;
    // Retain the original order if the checkout response is lost.
    const purchase: PendingPurchase = { selection, action, intentId: intent.id, url: null };
    savePending(purchase);
    if (active.current) { setConfirmation(null); setPendingOpen(false); }
    try {
      let url = action === "checkout" ? (await billing.checkout(intent.id)).checkoutUrl : (await billing.change(action, selection.plan!, selection.billingCycle!)).invoiceUrl;
      if (url) url = secureBillingUrl(url);
      savePending({ ...purchase, url });
      if (url && active.current) {
        if (opener) await opener(url);
        else if (tab && !tab.closed) tab.location.replace(url);
        else throw new Error("Could not open checkout. Use Reopen checkout to try again.");
      } else {
        tab?.close();
        if (active.current) throw new Error("The payment link is unavailable. Use Reopen checkout to try again.");
      }
      if (active.current) { setNotice(null); setPendingOpen(true); }
    } catch (cause) {
      tab?.close();
      if (cause instanceof AgentLensError && cause.status && cause.status >= 400 && cause.status < 500 && cause.serverCode !== "PAYMENT_PENDING") savePending(null);
      throw cause;
    }
  }

  const confirm = () => {
    if (!confirmation || !billing || locked.current) return Promise.resolve();
    return run(async () => {
      await billing.subscription(confirmation);
      if (!active.current) return;
      setConfirmation(null); setNotice("Renewal canceled. Your current plan remains active until the end of the subscription term.");
      await load(); await refreshAccount.current?.();
    });
  };
  const reopen = () => run(async () => {
    if (!billing || !pending) return;
    let url = pending.url;
    if (!url) {
      if (pending.action === "upgrade") throw new Error("The original invoice link is unavailable. Open Manage billing to review the pending payment.");
      url = (await billing.checkout(pending.intentId!)).checkoutUrl;
    }
    url = secureBillingUrl(url);
    savePending({ ...pending, url });
    const opener = systemBrowserOpener();
    if (opener) await opener(url);
    else if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Allow browser pop-ups to open the payment page.");
  });
  const manage = () => run(async () => {
    if (!billing) return;
    const url = secureBillingUrl((await billing.portal()).portalUrl);
    const opener = systemBrowserOpener();
    if (opener) await opener(url);
    else if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Allow browser pop-ups to open billing.");
  });
  const keepCurrent = () => run(async () => {
    if (!billing || !dashboard) return;
    await billing.subscription(dashboard.cancelAtPeriodEnd ? "resume" : "cancel-scheduled-change");
    if (!active.current) return;
    setNotice(`${dashboard.plan[0]!.toUpperCase()}${dashboard.plan.slice(1)} will remain your current plan.`);
    await load(); await refreshAccount.current?.();
  });
  return { catalog, dashboard, busy, error, notice, pending, pendingOpen, success, confirmation, prepare, confirm, cancel: () => { savePending(null); setConfirmation(null); setPendingOpen(false); setSuccess(null); setNotice(null); setError(null); }, showPending: () => setPendingOpen(true), keepCurrent, check: () => run(() => check()), reopen, manage, reload: () => run(async () => { await load(); await refreshAccount.current?.(); }) };
}
