import { useEffect, useMemo, useRef, useState } from "react";
import { checkoutReplacement, type CheckoutConfirmation, type CheckoutReplacement, hasActiveSubscription, secureBillingUrl, lifecycleSelection, type LifecycleState, type LifecycleAction, type PaymentMethod, type BillingDashboard, type BillingPlanConfig, type BillingPort, type PurchaseIntent, type PurchaseSelection } from "../../api/billing";
import { useHostWindow } from "./HostDocument";
import { systemBrowserOpener } from "./useWorkbenchSession";
import { AgentLensError } from "../../core/errors";

interface ReplacementConfirmation { selection: PurchaseSelection; intent: PurchaseIntent; paymentMethod: PaymentMethod; details: CheckoutReplacement }
interface LifecycleReplacement {
  selection: PurchaseSelection;
  action: LifecycleAction;
  method?: PaymentMethod | undefined;
  reservation?: NonNullable<LifecycleState["future"]>;
}
interface PendingPurchase { checkoutConfirmation?: CheckoutConfirmation; amount?: number; currency?: string; lifecycle?: boolean; lifecycleKind?: string | undefined; lifecycleAction?: LifecycleAction | undefined; selection: PurchaseSelection; action: "checkout" | "upgrade"; intentId: string | null; url: string | null; paymentMethod?: PaymentMethod | undefined }
function isScheduleAuthorization(pending: PendingPurchase | null | undefined) {
  return (pending?.lifecycleAction?.action ?? pending?.lifecycleKind) === "SCHEDULE";
}

type ShortcutKind = "restore" | "cancel-reservation";
interface ShortcutConfirmation { kind: ShortcutKind; snapshot: LifecycleState; action?: LifecycleAction; requestKey: string; submitted: boolean }
function shortcutTerms(kind: ShortcutKind, state: LifecycleState | null, actions: LifecycleAction[] | null) {
  if (!state || !actions?.length || actions.some(action => action.stateVersion !== state.stateVersion)) return null;
  if (kind === "cancel-reservation") return state.future?.kind === "SCHEDULE" && state.future.cancelAvailable === true ? {snapshot:state} : null;
  const renewal = state.renewal;
  if (!renewal?.canceled || renewal.restoreAvailable !== true) return null;
  const action = actions.find(value => value.plan.toLowerCase() === renewal.plan.toLowerCase() && value.mode === renewal.mode && value.action === "RESUME" && value.enabled && !value.resumeIntentId);
  if (!action?.description || (action.futureId ?? null) !== (state.future?.id ?? null)) return null;
  if (state.future && (state.future.kind !== "ONE_OFF" || state.future.state !== "READY" || state.future.paidAmount == null || !state.future.currency)) return null;
  return {snapshot:state,action};
}
const pendingShortcuts = new WeakMap<BillingPort, Map<string, ShortcutConfirmation>>();

type BillingActivity = PaymentMethod | "billing";
const pendingPurchases = new WeakMap<BillingPort, Map<string, PendingPurchase>>();
export function useBilling(billing: BillingPort | undefined, accountId: string, onAccountChanged?: () => Promise<void>) {
  const window = useHostWindow();
  const [lifecycleActions, setLifecycleActions] = useState<LifecycleAction[] | null>(null);
  const [lifecycleState, setLifecycleState] = useState<LifecycleState | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState<ShortcutConfirmation | null>(billing ? pendingShortcuts.get(billing)?.get(accountId) ?? null : null);
  const [catalog, setCatalog] = useState<BillingPlanConfig[] | null>(null);
  const [dashboard, setDashboard] = useState<BillingDashboard | null>(null);
  const [activity, setActivity] = useState<BillingActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"shortcut" | "cancel-at-period-end" | "replace-checkout" | "replace-reservation" | ReplacementConfirmation | null>(null);
  const [replacement, setReplacement] = useState<LifecycleReplacement | null>(null);
  const [pending, setPending] = useState<PendingPurchase | null>(billing ? pendingPurchases.get(billing)?.get(accountId) ?? null : null);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [success, setSuccess] = useState<PurchaseSelection["itemType"] | null>(null);
  // Each account/port lifetime owns its async results and lock, including A → B → A.
  const active = useMemo(() => ({ current: false }), [billing, accountId]);
  const isCurrent = () => active.current;
  const locked = useMemo(() => ({ current: false }), [active]);
  const readyRef = useMemo(() => ({ current: false }), [active]);
  const [dataOwner, setDataOwner] = useState(active);
  const [ready, setReady] = useState(false);
  const refreshAccount = useRef(onAccountChanged);
  refreshAccount.current = onAccountChanged;
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not contact billing. Please try again.");
  function savePending(value: PendingPurchase | null) {
    if (!active.current) return;
    if (billing) {
      let purchases = pendingPurchases.get(billing);
      if (!purchases) { purchases = new Map(); pendingPurchases.set(billing, purchases); }
      if (value) purchases.set(accountId, value); else purchases.delete(accountId);
    }
    if (isCurrent()) setPending(value);
  }
  async function run(action: () => Promise<void>, nextActivity: BillingActivity | null = "billing") {
    if (locked.current || !billing || !active.current) return;
    locked.current = true;
    if (nextActivity) { setActivity(nextActivity); setError(null); }
    try { await action(); } catch (cause) { if (active.current) { if (nextActivity) report(cause); } }
    finally { locked.current = false; if (active.current && nextActivity) setActivity(null); }
  }
  async function load() {
    if (!billing || !active.current) return;
    readyRef.current = false; setReady(false);
    // Keep independent successful reads visible; a failed refresh retains scoped cached data.
    const results = await Promise.allSettled([
      billing.plans().then(value => { if (active.current) setCatalog(value); }),
      billing.dashboard().then(value => { if (active.current) setDashboard(value); }),
      (billing.lifecycleActions?.() ?? Promise.resolve(null)).catch(() => null).then(async actions => {
        if (!active.current) return;
        setLifecycleActions(actions);
        setLifecycleError(!actions ? "Payment options are unavailable. Refresh status before changing your plan." : null);
        if (actions && billing.lifecycleState) {
          try { const state = await billing.lifecycleState(); if (active.current) setLifecycleState(state); }
          catch { if (active.current) { setLifecycleState(null); setLifecycleActions(null); setLifecycleError("Current and future plan information is unavailable. Refresh status before changing your plan."); } }
        }
        if ((pending && dataOwner === active) || pendingPurchases.get(billing)?.has(accountId)) return;
        const recovery = accountId ? await billing.pendingCheckout?.() : null;
        if (!active.current) return;
        if (recovery) {
          savePending({ selection: { itemType: "subscription", plan: recovery.plan, billingCycle: recovery.billingCycle }, action: "checkout", intentId: recovery.intentId, paymentMethod: recovery.paymentMethod, url: null, amount: recovery.amount, currency: recovery.currency, checkoutConfirmation: { requestKey: recovery.requestKey } });
          return;
        }
        if (actions && billing.lifecyclePending) {
          const remote = await billing.lifecyclePending();
          if (remote && active.current) {
            if (remote.action === "SCHEDULE") setPendingOpen(false);
            savePending({lifecycle: true, lifecycleKind: remote.action, action: "checkout", intentId: remote.intentId, url: null,
              selection: {itemType: "subscription", plan: remote.plan, billingCycle: remote.billingCycle},
              paymentMethod: remote.mode.startsWith("O") ? "wallet" : "card", amount: remote.amount, currency: remote.currency });
          }
        }
      })
    ]);
    if (!active.current) return;
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
    readyRef.current = true; setReady(true);
  }
  useEffect(() => {
    active.current = true;
    setActivity(null);
    setDataOwner(active); setCatalog(null); setDashboard(null); setLifecycleActions(null); setLifecycleState(null); setLifecycleError(null); setShortcut(billing ? pendingShortcuts.get(billing)?.get(accountId) ?? null : null);
    setReady(false); setError(null); setNotice(null); setConfirmation(null); setReplacement(null);
    const original = billing ? pendingPurchases.get(billing)?.get(accountId) ?? null : null;
    setSuccess(null); setPendingOpen(!isScheduleAuthorization(original));
    setPending(original);
    void run(load);
    return () => { active.current = false; readyRef.current = false; };
  }, [active]);

  async function check(automatic = false, isPollCurrent = () => true) {
    if (!billing || !pending) return;
    let intent: PurchaseIntent | null;
    let state: BillingDashboard;
    let lifecycleStatus: string | undefined;
    try {
      if (pending.lifecycle && pending.intentId) lifecycleStatus = (await billing.lifecycleReconcile?.(pending.intentId))?.status;
      if (!active.current || !isPollCurrent()) return;
      if (pending.lifecycle && ['schedule_ready', 'schedule_canceled', 'schedule_canceled_refund', 'schedule_canceled_original_ended', 'schedule_unchanged', 'future_preparation_expired'].includes(lifecycleStatus ?? '')) {
        savePending(null);
        setNotice(lifecycleStatus === 'schedule_canceled_original_ended' ? "The reservation is canceled. The original renewal ended before restoration could complete. Check Manage billing for your current plan and any refund, or contact Support." : lifecycleStatus === 'schedule_canceled_refund' ? "The reservation is canceled. A payment collected during cancellation is being refunded separately; this does not mean the refund has arrived. Check Manage billing for its status." : lifecycleStatus === 'future_preparation_expired' ? "The original reservation was canceled, but its start date has been reached. No new checkout was created. Refresh Manage billing before choosing another plan." : lifecycleStatus === 'schedule_unchanged' ? "Replacement was not applied. The original reservation remains in force; check Manage billing before another change." : lifecycleStatus === 'schedule_ready' ? "Your automatic plan is reserved. It will be charged at the scheduled start; no payment has been collected. Open Manage billing to review or cancel the reservation." : "The unpaid reservation is canceled. No refund is needed.");
        await load(); if(active.current && isPollCurrent())await refreshAccount.current?.();return;
      }
      if(['schedule_cancel_pending','schedule_repair'].includes(lifecycleStatus ?? '')) {
        if(active.current && !automatic)setNotice(lifecycleStatus === 'schedule_repair' ? "The reservation collection has been closed, but the original renewal needs billing review. Check Manage billing or contact Support before another change." : "Your cancellation request is saved. The original payment is being checked; do not start another payment.");
        return;
      }
      if(['renewal_restored','renewal_canceled','renewal_restore_failed'].includes(lifecycleStatus ?? '')) {
        if(!active.current)return;
        savePending(null);
        setNotice(lifecycleStatus==='renewal_restored'?"The original automatic renewal is restored. No payment or new credits were issued. Any confirmed future refund is processed separately.":lifecycleStatus==='renewal_canceled'?"Automatic renewal is canceled. Your current paid term remains until its original expiry. Check Manage billing for any reservation payment reconciliation.":"The original renewal could not be restored before its boundary. Your original payment and future-plan records are retained; check Manage billing for their current status.");
        await load();if(active.current&&isPollCurrent())await refreshAccount.current?.();return;
      }
      if(lifecycleStatus==='renewal_pending'){if(active.current&&!automatic)setNotice("The original renewal operation is being checked. No new payment is required.");return;}
      if(lifecycleStatus === 'replacement_pending'){if(active.current && !automatic)setNotice("The reservation change is being checked. No new payment is required; check its status before another change.");return;}
      if (lifecycleStatus?.startsWith("checkout_replacement_")) {
        if (await replacementFinished(lifecycleStatus === "checkout_replacement_old_paid" ? "OLD_PAID" : lifecycleStatus === "checkout_replacement_review_required" ? "REVIEW_REQUIRED" : "CLOSING_OLD")) return;
        if (!automatic) setNotice("The original payment still needs verification. Use Reopen checkout to resume this replacement.");
        return;
      }
      if(lifecycleStatus === 'schedule_pending'){if(!automatic)setNotice("Waiting for authorization. Continue authorization or check its status in Manage billing.");return;}
      // Read the order first; the account snapshot must follow its committed payment.
      intent = pending.intentId ? await billing.intent(pending.intentId) : null;
      if (!active.current || !isPollCurrent()) return;
      state = await billing.dashboard();
    } catch (cause) {
      if (cause instanceof AgentLensError && cause.serverCode === "PURCHASE_INTENT_EXPIRED") {
        if (!active.current || !isPollCurrent()) return;
        savePending(null);
        setNotice("This payment link has expired. Check Manage billing for the original payment before purchasing again.");
        await load(); if (active.current) await refreshAccount.current?.(); return;
      }
      throw cause;
    }
    if (!active.current || !isPollCurrent()) return;
    setDashboard(state);
    const entitlementApplied = pending.selection.itemType === "addon" || (state.plan === pending.selection.plan && state.billingCycle === pending.selection.billingCycle
      && hasActiveSubscription(state) && state.checkoutStatus !== "payment_pending");
    const terminalFailure = Boolean(intent && ["expired", "failed", "refunded"].includes(intent.checkoutStatus));
    const fundedFuture = pending.lifecycle && lifecycleStatus === "future_funded" && intent?.checkoutStatus === "paid";
    const paid = !terminalFailure && (fundedFuture || (entitlementApplied && (pending.action === "upgrade" || intent?.checkoutStatus === "paid")));
    if (paid) {
      await refreshAccount.current?.();
      if (!active.current || !isPollCurrent()) return;
      savePending(null); setNotice(fundedFuture ? "Your future plan is paid. Your current plan and credits remain unchanged until the scheduled start. Open Manage billing to review or cancel the future plan." : null); setSuccess(pending.selection.itemType);
      if (pending.lifecycle) { setLifecycleActions([]); await load(); }
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
    if (!billing || locked.current || !readyRef.current) return Promise.resolve();
    const opener = systemBrowserOpener();
    const tab = !opener ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    return run(async () => {
    try {
    if (!billing) return;
    if (selection.itemType === "subscription" && lifecycleError) throw new Error(lifecycleError);
    const unfinished = pendingShortcuts.get(billing)?.get(accountId);
    if (selection.itemType === "subscription" && unfinished) { tab?.close(); setShortcut(unfinished); setConfirmation("shortcut"); return; }
    const state = await billing.dashboard();
    if (!isCurrent()) return;
    setDashboard(state); setNotice(null);
    let freshActions: LifecycleAction[] | null | undefined = null;
    if (selection.itemType === "subscription") {
      try { freshActions = await billing.lifecycleActions?.(); }
      catch {
        if (active.current) { setLifecycleActions(null); setLifecycleError("Payment options are unavailable. Refresh status before changing your plan."); }
        throw new Error("Payment options are unavailable. Refresh status before changing your plan.");
      }
    }
    if (!active.current) return;
    if (freshActions) {
      setLifecycleActions(freshActions);
      const selected = lifecycleSelection(freshActions, selection, paymentMethod);
      if (!selected?.enabled || !billing.lifecycleCheckout) throw new Error("This payment option is unavailable. Refresh the available actions.");
      const reservationReplacement = selected.action === "SCHEDULE" && !!selected.futureId
        && !selected.resumeIntentId && !selected.replacesIntentId;
      if (reservationReplacement) {
        tab?.close();
        const snapshot = await billing.lifecycleState?.();
        if (!isCurrent()) return;
        const reservation = snapshot?.future;
        if (snapshot?.stateVersion !== selected.stateVersion || !reservation || reservation.id !== selected.futureId
            || reservation.kind !== "SCHEDULE" || reservation.state !== "READY") {
          throw new Error("This payment option is unavailable. Refresh the available actions.");
        }
        setReplacement({selection, action: selected, method: paymentMethod, reservation});
        setConfirmation("replace-reservation");
        return;
      }
      if (selected.replacesIntentId) {
        tab?.close();
        setReplacement({selection, action: selected, method: paymentMethod});
        setConfirmation("replace-checkout");
        return;
      }
      if (selected.action === "SCHEDULE" && selected.resumeIntentId) {
        await startLifecycle(selection, selected, paymentMethod, opener, tab);
        return;
      }
      const displayed = lifecycleActions ? lifecycleSelection(lifecycleActions, selection, paymentMethod) : undefined;
      if (!displayed || displayed.stateVersion !== selected.stateVersion || displayed.action !== selected.action
          || displayed.description !== selected.description || displayed.futureId !== selected.futureId || displayed.replacesIntentId !== selected.replacesIntentId || displayed.resumeIntentId !== selected.resumeIntentId || displayed.amountMinor !== selected.amountMinor || displayed.summary !== selected.summary || displayed.impactDescription !== selected.impactDescription) {
        tab?.close();
        return;
      }
      await startLifecycle(selection, selected, paymentMethod, opener, tab);
      return;
    }
    if (selection.itemType === "subscription") {
      setLifecycleActions(null); setLifecycleError("Payment options are unavailable. Refresh status before changing your plan.");
      throw new Error("Payment options are unavailable. Refresh status before changing your plan.");
    }
    const action = "checkout";
    if (!hasActiveSubscription(state)) throw new Error("An active plan is required before adding credits.");
    const intent = await billing.createIntent(selection);
    await startPayment(selection, intent, action, opener, tab, paymentMethod);
    } catch (cause) { tab?.close(); throw cause; }
    }, paymentMethod ?? "card");
  };

  async function startLifecycle(selection: PurchaseSelection, action: LifecycleAction, method: PaymentMethod | undefined, opener: ReturnType<typeof systemBrowserOpener>, tab: Window | null) {
    if (!billing?.lifecycleCheckout) throw new Error("Billing is unavailable.");
    if (action.resumeIntentId && !billing.lifecycleResume) throw new Error("Billing is unavailable.");
    const intent = action.resumeIntentId ? await billing.intent(action.resumeIntentId) : await billing.createIntent(selection);
    if (!active.current) { tab?.close(); return; }
    if (!action.resumeIntentId && action.amountMinor != null && (intent.currency !== "USD" || Math.round(intent.displayedAmount * 100) !== action.amountMinor)) throw new Error("The price changed. Review the updated selection before paying.");
    const purchase: PendingPurchase = { lifecycle: true, lifecycleAction: action.resumeIntentId ? undefined : action, selection, lifecycleKind: action.action, action: "checkout", intentId: intent.id, url: null, amount: intent.displayedAmount, currency: intent.currency, ...(method ? {paymentMethod: method} : {}) };
    savePending(purchase);
    if (!active.current) { tab?.close(); return; }
    const replacingReservation = action.action === "SCHEDULE" && !!action.futureId && !action.resumeIntentId && !action.replacesIntentId;
    setPendingOpen(!replacingReservation);
    const response = action.resumeIntentId ? await billing.lifecycleResume!(intent.id) : await billing.lifecycleCheckout(intent.id, action);
    if (await replacementFinished(response.state)) { tab?.close(); return; }
    if (replacingReservation && response.state === "VERIFIED") {
      tab?.close(); savePending(null);
      await load(); if (active.current) await refreshAccount.current?.();
      return;
    }
    if (action.resumeIntentId && action.action === "SCHEDULE" && ["READY", "CANCELED", "CLOSED", "EXECUTED"].includes(response.state)) {
      tab?.close(); savePending(null);
      await load(); if (active.current) await refreshAccount.current?.();
      return;
    }
    const url = response.checkoutUrl ? secureBillingUrl(response.checkoutUrl, "lifecycleCheckout") : null;
    savePending({...purchase, url});
    if (url && active.current) {
      if (opener) await opener(url);
      else if (tab && !tab.closed) tab.location.replace(url);
      else throw new Error("Could not open checkout. Use Reopen checkout.");
    } else {tab?.close();if (active.current) setNotice(["RESUME","CANCEL_A"].includes(action.action)?"Check the original renewal operation before continuing.":"Check the original payment status before continuing.");}
  }

  async function startPayment(selection: PurchaseSelection, intent: PurchaseIntent, action: "checkout" | "upgrade", opener: ReturnType<typeof systemBrowserOpener>, tab: Window | null, paymentMethod?: PaymentMethod, checkoutConfirmation?: CheckoutConfirmation) {
    if (!billing) return;
    const previousPending = pending;
    // Retain the original order if the checkout response is lost.
    const purchase: PendingPurchase = { ...(checkoutConfirmation ? { checkoutConfirmation } : {}), selection, action, intentId: intent.id, url: null, paymentMethod };
    savePending(purchase);
    if (!active.current) { tab?.close(); return; }
    if (active.current) { setConfirmation(null); setPendingOpen(false); }
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

  async function replacementFinished(state: string) {
    if (!["OLD_PAID", "REVIEW_REQUIRED"].includes(state)) return false;
    if (!active.current) return true;
    savePending(null); setPendingOpen(false);
    setNotice(state === "OLD_PAID" ? "Your original payment was received. Its original plan is being applied. No replacement payment was started." : "The original checkout is closed. Billing terms changed; review your selection before paying again.");
    await load(); if (active.current) await refreshAccount.current?.();
    return true;
  }
  async function readShortcutState() {
    try {
      const [state, actions] = await Promise.all([billing!.lifecycleState!(),billing!.lifecycleActions!()]);
      if (active.current) {
        setLifecycleState(state); setLifecycleActions(actions);
        setLifecycleError(actions ? null : "Renewal actions are unavailable. Refresh status or use Manage billing.");
      }
      return [state,actions] as const;
    } catch {
      if (active.current) {
        setLifecycleActions(null);
        setLifecycleError("Renewal actions are unavailable. Refresh status or use Manage billing.");
      }
      throw new Error("Renewal actions are unavailable. Refresh status or use Manage billing.");
    }
  }
  const confirm = () => {
    if (!confirmation || !billing || locked.current || !readyRef.current) return Promise.resolve();
    return run(async () => {
      if (confirmation === "shortcut" && shortcut && billing.lifecycleState && billing.lifecycleActions) {
        if (shortcut.submitted) {
          await load(); if (active.current) await refreshAccount.current?.();
          if (active.current) setNotice("The original request has been checked. Review its current state in Manage billing before another operation.");
          return;
        }
        const [state, actions] = await readShortcutState();
        if (!active.current) return;
        setLifecycleState(state); setLifecycleActions(actions);
        const fresh = shortcutTerms(shortcut.kind,state,actions);
        if (!fresh || JSON.stringify(fresh) !== JSON.stringify({snapshot:shortcut.snapshot,...(shortcut.action ? {action:shortcut.action} : {})})) {
          setConfirmation(null); setShortcut(null);
          throw new Error("Billing terms changed. Review the current renewal and future plan before confirming again.");
        }
        // Retain the exact consent and request identity if the response is uncertain.
        const submitted = {...shortcut,submitted:true};
        let shortcuts = pendingShortcuts.get(billing);
        if (!shortcuts) { shortcuts = new Map(); pendingShortcuts.set(billing,shortcuts); }
        shortcuts.set(accountId,submitted);
        setShortcut(submitted);
        const response = shortcut.kind === "restore"
          ? await billing.lifecycleRestoreRenewal!({stateVersion:shortcut.snapshot.stateVersion, requestKey:shortcut.requestKey, futureId:shortcut.snapshot.future?.id ?? null, confirmed:true})
          : await billing.lifecycleCancelFuture!(shortcut.snapshot.future!.id,shortcut.snapshot.stateVersion);
        if (shortcuts.get(accountId) === submitted) shortcuts.delete(accountId);
        if (!active.current) return;
        setNotice(shortcut.kind === "restore"
          ? response.status === "COMPLETED" ? "Original automatic renewal is restored. Your current period and credits are unchanged. Any future-plan refund is processed separately; this does not confirm bank arrival." : "The original renewal restoration is being reconciled. Check Manage billing before another change."
          : "The reservation cancellation request is recorded. Check Manage billing for the original renewal and any payment reconciliation; this does not confirm a refund has arrived.");
        setConfirmation(null); setShortcut(null);
        await load(); if (active.current) await refreshAccount.current?.(); return;
      }
      if (typeof confirmation === "object") {
        const replacement = confirmation;
        const opener = systemBrowserOpener();
        const tab = !opener ? window.open("about:blank", "_blank") : null;
        if (tab) tab.opener = null;
        await startPayment(replacement.selection, replacement.intent, "checkout", opener, tab, replacement.paymentMethod,
          { requestKey: replacement.details.requestKey, replacesOrderId: replacement.details.oldOrderId, confirmed: true, confirmedAmount: replacement.details.amount, currency: replacement.details.currency });
        return;
      }
      if ((confirmation === "replace-checkout" || confirmation === "replace-reservation") && replacement) {
        const actions = await billing.lifecycleActions?.();
        if (!active.current) return;
        const current = actions && lifecycleSelection(actions, replacement.selection, replacement.method);
        setLifecycleActions(actions ?? null);
        if (!current || !current.enabled || JSON.stringify(current) !== JSON.stringify(replacement.action)) throw new Error("Billing terms changed. Close this confirmation and review the updated selection.");
        setConfirmation(null); setReplacement(null);
        const opener = systemBrowserOpener();
        const tab = !opener ? window.open("about:blank", "_blank") : null;
        if (tab) tab.opener = null;
        try { await startLifecycle(replacement.selection, replacement.action, replacement.method, opener, tab); }
        catch (cause) { tab?.close(); throw cause; }
        return;
      }
      if (confirmation !== "cancel-at-period-end") return;
      await billing.subscription(confirmation);
      if (!isCurrent()) return;
      setConfirmation(null); setNotice("Renewal canceled. Your current plan remains active until the end of the subscription term.");
      await load(); if (active.current) await refreshAccount.current?.();
    });
  };
  const reopen = () => run(async () => {
    if (!billing || !pending) return;
    let url = pending.url;
    if (pending.lifecycle) {
      const response = pending.lifecycleAction
        ? await billing.lifecycleCheckout?.(pending.intentId!, pending.lifecycleAction)
        : await billing.lifecycleResume?.(pending.intentId!);
      if (response && await replacementFinished(response.state)) return;
      if (isScheduleAuthorization(pending) && response && !response.checkoutUrl
          && ["VERIFIED", "READY", "CANCELED", "CLOSED", "EXECUTED"].includes(response.state)) {
        await check();
        return;
      }
      if (!response?.checkoutUrl) throw new Error("Check the original payment status before continuing.");
      url = response.checkoutUrl;
    }
    if (!url) {
      if (pending.action === "upgrade") throw new Error("The original invoice link is unavailable. Open Manage billing to review the pending payment.");
      url = (await (pending.checkoutConfirmation ? billing.checkout(pending.intentId!, pending.paymentMethod, pending.checkoutConfirmation) : pending.paymentMethod ? billing.checkout(pending.intentId!, pending.paymentMethod) : billing.checkout(pending.intentId!))).checkoutUrl;
    }
    url = secureBillingUrl(url, pending.lifecycle ? "lifecycleCheckout" : pending.action === "checkout" ? "checkout" : "invoice");
    savePending({ ...pending, url });
    if (!active.current) return;
    const opener = systemBrowserOpener();
    if (opener) await opener(url);
    else if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Allow browser pop-ups to open the payment page.");
  });
  const manage = () => run(async () => {
    if (!billing) return;
    const lifecycle = lifecycleActions !== null;
    const url = secureBillingUrl((await billing.portal(lifecycle)).portalUrl, lifecycle ? "lifecyclePortal" : "portal");
    if (!isCurrent()) return;
    const opener = systemBrowserOpener();
    if (opener) await opener(url);
    else if (!window.open(url, "_blank", "noopener,noreferrer")) throw new Error("Allow browser pop-ups to open billing.");
  });
  const keepCurrent = (kind: ShortcutKind = "cancel-reservation") => run(async () => {
    const unfinishedShortcut = billing ? pendingShortcuts.get(billing)?.get(accountId) : null;
    if (unfinishedShortcut) { setShortcut(unfinishedShortcut); setConfirmation("shortcut"); return; }
    if (!billing?.lifecycleState || !billing.lifecycleActions || !readyRef.current || lifecycleError || pending) return;
    if (kind === "restore" ? !billing.lifecycleRestoreRenewal : !billing.lifecycleCancelFuture) return;
    const displayed = shortcutTerms(kind,lifecycleState,lifecycleActions);
    if (!displayed) throw new Error("This shortcut is unavailable. Refresh status or use Manage billing.");
    const [state, actions] = await readShortcutState();
    if (!active.current) return;
    setLifecycleState(state);setLifecycleActions(actions);
    const fresh = shortcutTerms(kind,state,actions);
    if (!fresh || JSON.stringify(fresh) !== JSON.stringify(displayed)) throw new Error("Billing terms changed. Review the current renewal and future plan before confirming again.");
    setShortcut({kind,...fresh,requestKey:crypto.randomUUID(),submitted:false});setConfirmation("shortcut");
  });
  const owned = dataOwner === active;
  const canUseShortcut = owned && ready && !lifecycleError && !pending && activity === null && !confirmation;
  return { shortcut: owned ? shortcut : null,
    canRestoreRenewal: Boolean(canUseShortcut && billing?.lifecycleRestoreRenewal && shortcutTerms("restore",lifecycleState,lifecycleActions)),
    canCancelReservation: Boolean(canUseShortcut && billing?.lifecycleCancelFuture && shortcutTerms("cancel-reservation",lifecycleState,lifecycleActions)),
    lifecycleState: owned ? lifecycleState : null, lifecycleError: owned ? lifecycleError : null, ready: owned && ready, lifecycleActions: owned ? lifecycleActions : null, catalog: owned ? catalog : null, dashboard: owned ? dashboard : null, busy: owned ? activity !== null : true, activity: owned ? activity : null, error: owned ? error : null, notice: owned ? notice : null, pending: owned ? pending : null, pendingOpen, success: owned ? success : null, confirmation: owned ? confirmation : null, replacement: owned ? replacement : null, prepare, confirm, cancel: () => { if (confirmation === null && !isScheduleAuthorization(pending)) savePending(null); setConfirmation(null); setShortcut(null); setReplacement(null); setPendingOpen(false); setSuccess(null); setNotice(null); setError(null); }, showPending: () => setPendingOpen(true), keepCurrent, check: () => run(() => check()), reopen, manage, reload: () => run(async () => { await load(); if (active.current) await refreshAccount.current?.(); }) };
}
