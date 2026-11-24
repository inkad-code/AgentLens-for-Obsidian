import { useEffect, useId, useRef, useState } from "react";
import alipayIcon from "./assets/pricing-alipay.svg";
import wechatPayIcon from "./assets/pricing-wechat-pay.svg";
import { billingAssets } from "./billingAssets";
import { checkoutReplacementCopy, lifecycleSelection, lifecycleReason, billingAction, hasActiveSubscription, type BillingPort, type BillingPlan, type PaymentMethod, type PurchaseSelection } from "../../api/billing";
import { useBilling } from "./useBilling";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { useHostWindow } from "./HostDocument";
import { FeedbackIcon } from "./FeedbackIcon";

const plans = [
  { id: "basic", name: "Basic", description: "20 free credits monthly", monthly: 0, annual: 0, credits: "20", support: "No credit card required" },
  { id: "pro", name: "Pro", description: "For regular use", monthly: 2.90, annual: 29.90, credits: "300", support: "Email support" },
  { id: "ultra", name: "Ultra", description: "For frequent use", monthly: 6.90, annual: 69.90, credits: "1,000", support: "Email support" },
  { id: "mega", name: "Mega", description: "For higher-volume use", monthly: 9.90, annual: 99.90, credits: "2,000", support: "Priority support" }
] as const;
const packs = [{ credits: 200, price: 2.90 }, { credits: 600, price: 6.90 }, { credits: 1200, price: 9.90 }] as const;
const money = (value: number | undefined) => value === undefined ? "…" : `$${value.toFixed(2)}`;

export function PlanSelectionPage({ currentPlan, onBack, billing, onAccountChanged, accountId = "preview" }: { currentPlan: string; onBack: () => void; billing?: BillingPort | undefined; onAccountChanged?: (() => Promise<void>) | undefined; accountId?: string }) {
  const payment = useBilling(billing, accountId, onAccountChanged);
  const activePlan = payment.dashboard?.plan ?? currentPlan.toLowerCase();
  const hostWindow = useHostWindow();
  const purchaseTrigger = useRef<HTMLElement | null>(null);
  function cancel() {
    if (payment.busy) return;
    payment.cancel();
    hostWindow.requestAnimationFrame(() => purchaseTrigger.current?.focus());
  }
  const [cycle, setCycle] = useState<"monthly" | "annual">(payment.pending?.selection.billingCycle === "yearly" ? "annual" : "monthly");
  const paymentPeriod = cycle === "annual" ? "year" : "month";
  const isCurrentPlan = (id: string) => Boolean(payment.dashboard && hasActiveSubscription(payment.dashboard)
    && payment.dashboard.plan === id
    && (id === "basic" || payment.dashboard.billingCycle === (cycle === "annual" ? "yearly" : "monthly")));
  const [selected, setSelected] = useState(payment.pending?.selection.itemType === "addon" ? "addon" : payment.pending?.selection.plan ?? "ultra");
  const [packCredits, setPackCredits] = useState(payment.pending?.selection.addonCredits ?? 200);
  const pack = packs.find(item => item.credits === packCredits) ?? packs[0];
  const plan = plans.find(item => item.id === selected) ?? plans[2];
  const price = (item: typeof plans[number]) => {
    const live = payment.catalog?.find(config => config.plan === item.id && config.active);
    return live ? (cycle === "monthly" ? live.priceMonthly : live.priceYearly) : billing ? undefined : item[cycle];
  };
  const summary = selected === "addon" ? `Add-on Packs (${pack.credits} credits) - ${money(pack.price)} one-off` : `${plan.name} - ${plan.id === "basic" ? "Free" : `${money(price(plan))}/${cycle === "monthly" ? "month" : "year"}`}`;
  const selection: PurchaseSelection = selected === "addon" ? { itemType: "addon", addonCredits: packCredits } : { itemType: "subscription", plan: selected as BillingPlan, billingCycle: selected === "basic" || cycle === "monthly" ? "monthly" : "yearly" };
  const serverCard = payment.lifecycleActions ? lifecycleSelection(payment.lifecycleActions, selection, "card") : undefined;
  const serverWallet = payment.lifecycleActions ? lifecycleSelection(payment.lifecycleActions, selection, "wallet") : undefined;
  const renewalOnly = ['RESUME','CANCEL_A'].includes(payment.pending?.lifecycleAction?.action ?? payment.pending?.lifecycleKind ?? '');
  const showCurrentPlan = serverCard?.action === "CURRENT" && !serverCard.resumeIntentId;
  const canContinue = Boolean(payment.ready && billing && payment.catalog && payment.dashboard && !payment.busy && !(payment.pending && payment.pendingOpen) && !payment.confirmation && (selected === "addon" ? hasActiveSubscription(payment.dashboard) : !payment.lifecycleError && payment.lifecycleActions));
  const walletCheckout = selection.itemType === "subscription" && selected !== "basic";
  const walletAvailable = serverWallet?.enabled === true;
  const confirmation = payment.confirmation;
  const termEnd = payment.dashboard?.subscriptionTermEndsAt;
  const termDate = termEnd && !Number.isNaN(Date.parse(termEnd)) ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(termEnd)) : "the end of your current subscription term";
  const scheduleAuthorization = (payment.pending?.lifecycleAction?.action ?? payment.pending?.lifecycleKind) === "SCHEDULE";
  const pendingDialog = Boolean(payment.pending && payment.pendingOpen);
  const scheduledDate = payment.dashboard?.scheduledEffectiveAt;
  const cardReason = selection.itemType === "subscription" && serverCard?.enabled === false ? serverCard.reason.trim() : "";
  const walletReason = walletCheckout && serverWallet?.enabled === false ? serverWallet.reason.trim() : "";
  const [shownPaymentReason, setShownPaymentReason] = useState<PaymentMethod | null>(null);
  const paymentFeedbackId = useId();
  useEffect(() => setShownPaymentReason(null), [accountId, selected, cycle, payment.lifecycleActions]);
  const basicExpiry = selected === "basic" && activePlan !== "basic" && payment.dashboard?.oneTimePurchase === true;
  const paymentReason = shownPaymentReason === "card" && cardReason ? { label: "Credit Card", reason: cardReason }
    : shownPaymentReason === "wallet" && walletReason ? { label: "Alipay / WeChat Pay", reason: walletReason } : null;
  const disabledReason = (reason: string) => reason === "BLOCK_AO"
    ? "A one-time purchase at the same tier is unavailable while your automatic plan remains active. You can purchase after the current paid term ends."
    : reason === "BLOCK_OB" && basicExpiry
      ? "Basic is not a purchasable plan. Your paid one-time plan continues until its expiry."
      : lifecycleReason(reason);
  const noPaymentOption = payment.ready && payment.lifecycleActions && walletCheckout
    && !serverCard?.enabled && !walletAvailable && !cardReason && !walletReason;
  const replacement = confirmation === "replace-checkout" || confirmation === "replace-reservation" ? payment.replacement : null;
  const reservation = confirmation === "replace-reservation" ? replacement?.reservation : undefined;
  const previousPlan = plans.find(item => item.id === reservation?.plan.toLowerCase());
  const nextPlan = plans.find(item => item.id === replacement?.selection.plan);
  const reservationCopy = reservation && previousPlan && nextPlan ? {
    title: `Replace ${previousPlan.name} with ${nextPlan.name}?`,
    body: `${nextPlan.name} is scheduled to start on ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(reservation.effectiveAt))}. You won’t be charged today.`,
  } : null;
  const replacingReservation = reservationCopy !== null;
  const replacingAuthorization = replacement?.action.replacesAuthorization === true;
  const cancelingRenewal = replacement?.action.action === "CANCEL_A";
  const replacementSelection = replacement?.selection;
  const newOrder = replacement && !replacingReservation && !cancelingRenewal && replacementSelection?.plan && replacementSelection.billingCycle
    ? checkoutReplacementCopy({
      plan: replacementSelection.plan,
      billingCycle: replacementSelection.billingCycle,
      paymentMethod: replacement.method ?? "card",
      amount: replacement.action.amountMinor == null ? null : replacement.action.amountMinor / 100,
      currency: "USD",
    })
    : typeof confirmation === "object" && confirmation ? checkoutReplacementCopy(confirmation.details) : null;
  const legacyReplacement = typeof confirmation === "object" && confirmation !== null;
  const replacingOrder = confirmation === "replace-checkout" || legacyReplacement;
  const shortcutFuture = payment.shortcut?.snapshot.future;

  function planState(id: BillingPlan) {
    if (payment.catalog && !payment.catalog.some(item => item.plan === id && item.active)) return "unavailable";
    if (!payment.dashboard) return activePlan === id ? "current" : "checkout";
    return billingAction(payment.dashboard, id, id === "basic" || cycle === "monthly" ? "monthly" : "yearly");
  }
  function indicator(id: string) {
    const checked = selected === id;
    return <span className="agentlens-pricing-indicator" aria-hidden="true"><img src={checked ? billingAssets.selectedCircle : billingAssets.circle} width="20" height="20" alt="" />{checked && <span>✓</span>}</span>;
  }
  const planRegionLabelId = useId();
  return <section className="agentlens-pricing-page" aria-labelledby={planRegionLabelId}>
    <span id={planRegionLabelId} hidden>Choose a plan</span>
    <div className="agentlens-pricing-header">
      <button className="agentlens-pricing-back" type="button" onClick={onBack}><img src={billingAssets.back} width="18" height="18" alt="" /><span>Back</span></button>
      <div className="agentlens-pricing-cycle" role="group" aria-label="Billing cycle">
        <button type="button" disabled={Boolean(confirmation || pendingDialog)} aria-pressed={cycle === "monthly"} onClick={() => setCycle("monthly")}>Monthly</button>
        <button type="button" disabled={Boolean(confirmation || pendingDialog)} aria-pressed={cycle === "annual"} onClick={() => setCycle("annual")}>Annual <span>save ~16%</span></button>
      </div>
    </div>
    <div className="agentlens-pricing-content">
      <fieldset className="agentlens-pricing-selection" disabled={Boolean(confirmation || pendingDialog)}>
      <div className="agentlens-pricing-grid">
        {plans.map(item => <button key={item.id} type="button" className={`agentlens-pricing-card${selected === item.id ? " is-selected" : ""}${isCurrentPlan(item.id) ? " is-current" : ""}${payment.catalog?.some(config => config.plan === item.id && !config.active) ? " is-unavailable" : ""}`} aria-pressed={selected === item.id} aria-label={`Select ${item.name}`} onClick={() => setSelected(item.id)}>
          {indicator(item.id)}
          {item.id === "ultra" && <span className="agentlens-pricing-popular">Most Popular</span>}
          <span className="agentlens-pricing-heading"><span className="agentlens-pricing-title">{item.name}</span><span className="agentlens-pricing-description">{item.description}</span></span>
          <span className="agentlens-pricing-price"><strong>{item.id === "basic" ? "Free" : money(price(item))}</strong>{item.id !== "basic" && <span>/ {cycle === "monthly" ? "month" : "year"}</span>}</span>
          <span className="agentlens-pricing-details"><span className="agentlens-pricing-credits"><span>Credits</span><strong>{payment.catalog?.find(config => config.plan === item.id)?.creditsLimit.toLocaleString("en-US") ?? (billing ? "…" : item.credits)} / month</strong></span><span className="agentlens-pricing-features">{["All 20+ supported platforms", "Credits refresh every month", item.support].map(feature => <span key={feature}><i aria-hidden="true">✓</i>{feature}</span>)}</span></span>
          {isCurrentPlan(item.id) && <span className="agentlens-pricing-current">Current</span>}
          {planState(item.id) === "scheduled" && <span className="agentlens-pricing-plan-status">Scheduled</span>}
          {payment.catalog?.some(config => config.plan === item.id && !config.active) && <span className="agentlens-pricing-plan-status">Unavailable</span>}
        </button>)}
        <div className={`agentlens-pricing-card${selected === "addon" ? " is-selected" : ""}`}>
          <button className="agentlens-pricing-addon-select" type="button" aria-label="Select Add-on Packs" aria-pressed={selected === "addon"} onClick={() => setSelected("addon")}>{indicator("addon")}<span className="agentlens-pricing-heading"><span className="agentlens-pricing-title">Add-on Packs</span><span className="agentlens-pricing-description">Extra credits, on demand</span></span><span className="agentlens-pricing-price"><strong>{money(pack.price)}</strong><span>one-off</span></span></button>
          <div className="agentlens-pricing-details"><label className="agentlens-pricing-pack">Choose a pack<select style={{ backgroundImage: `url(${billingAssets.chevron})`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }} aria-label="Choose a pack" value={packCredits} onChange={event => { setPackCredits(Number(event.target.value)); setSelected("addon"); }}>{packs.map(item => <option key={item.credits} value={item.credits}>{item.credits.toLocaleString("en-US")} credits</option>)}</select></label><div className="agentlens-pricing-features">{["All 20+ supported platforms", "Add-on credits never expire"].map(feature => <span key={feature}><i aria-hidden="true">✓</i>{feature}</span>)}</div></div>
        </div>
      </div>
      </fieldset>
      {noPaymentOption && <p className="agentlens-pricing-summary" role="status">No payment option is available for this selection.</p>}
      {selected !== "addon" && payment.lifecycleError && <p role="status">{payment.lifecycleError} <button type="button" disabled={payment.busy} onClick={() => void payment.reload()}>Refresh payment options</button></p>}
      {payment.dashboard?.scheduledPlan && <div className="agentlens-pricing-scheduled"><p role="status"><strong>{plans.find(item => item.id === payment.dashboard?.scheduledPlan)?.name} {payment.dashboard.scheduledBillingCycle === "yearly" ? "Annual" : "Monthly"}</strong> scheduled for <strong>{scheduledDate ? new Date(scheduledDate).toLocaleDateString() : "the end of your term"}</strong>.</p><button type="button" disabled={!payment.canCancelReservation} onClick={() => void payment.keepCurrent("cancel-reservation")}>Keep current plan</button></div>}
      {payment.dashboard?.cancelAtPeriodEnd && <div className="agentlens-pricing-scheduled"><p role="status">Renewal canceled{termEnd ? " until " + termDate : ""}.</p>{!payment.dashboard.scheduledPlan && <button type="button" disabled={!payment.canRestoreRenewal} onClick={() => void payment.keepCurrent("restore")}>Resume renewal</button>}</div>}
      {((payment.dashboard?.scheduledPlan && !payment.canCancelReservation) || (payment.dashboard?.cancelAtPeriodEnd && !payment.canRestoreRenewal)) && <p role="status">Renewal shortcuts require synchronized server permission. Refresh status or use Manage billing to review the original operation.</p>}
      {selected === "addon" && payment.dashboard && !hasActiveSubscription(payment.dashboard) && <p role="status">An active plan is required before adding credits.</p>}
      {billing && !payment.ready && <p role="status">{payment.catalog || payment.dashboard ? "Cached billing information — awaiting synchronization." : "Billing information is not yet synchronized."} You can browse packages; refresh before submitting a new billing change.</p>}
      {payment.dashboard?.checkoutStatus === "payment_pending" && !payment.pending && <p role="status">A payment is already pending. Open Manage billing to complete or review it before purchasing again.</p>}
      {payment.notice && !pendingDialog && <p role="status">{payment.notice}</p>}
      {payment.pending && !pendingDialog && !payment.busy && <button type="button" onClick={event => { purchaseTrigger.current = event.currentTarget; payment.showPending(); }}>{scheduleAuthorization ? "Continue authorization" : "Pending payment"}</button>}
      {payment.success && <WorkbenchDialog title={payment.success === "addon" ? "Your recharge has been successful" : "Payment successful"} textClose closeOnBackdrop className="agentlens-pricing-checkout-dialog agentlens-billing-result-dialog agentlens-billing-success-dialog" onClose={cancel}>
        <span className="agentlens-billing-success-icon" aria-hidden="true"><FeedbackIcon name="check" /></span>
        {payment.notice && <p role="status">{payment.notice}</p>}
        <footer className="agentlens-pricing-checkout-actions"><button type="button" onClick={cancel}>Back</button></footer>
      </WorkbenchDialog>}
      {(confirmation || pendingDialog) && <WorkbenchDialog title={pendingDialog ? renewalOnly ? "Check your renewal operation" : scheduleAuthorization ? "Confirm your future plan in Stripe" : "Complete your purchase in Stripe" : reservationCopy ? reservationCopy.title : cancelingRenewal ? "Cancel renewal?" : replacingOrder ? "Continue with a new order?" : payment.shortcut ? payment.shortcut.kind === "restore" ? "Resume original subscription?" : "Cancel scheduled change?" : "Cancel renewal?"} hideClose={pendingDialog} textClose closeOnBackdrop className={`agentlens-pricing-checkout-dialog${legacyReplacement ? " agentlens-billing-result-dialog agentlens-billing-replacement-dialog" : pendingDialog ? " agentlens-billing-result-dialog" : ""}`} onClose={cancel}>
        {pendingDialog ? <>
          <p className="agentlens-pricing-checkout-subtitle">{renewalOnly ? "No new payment or credits are issued. Check the original renewal result." : scheduleAuthorization ? "You won’t be charged now. Your current plan and credits remain unchanged." : "We’ll update your billing status after payment is confirmed."}</p>
          {payment.notice && <p role="status">{payment.notice}</p>}
          {payment.error && payment.pending?.amount != null && payment.pending.currency && <p>Order amount: {payment.pending.amount.toFixed(2)} {payment.pending.currency}</p>}
          {payment.error && <p className="agentlens-parse-error" role="alert">{payment.error} <button type="button" disabled={payment.busy} onClick={() => void payment.reload()}>Retry</button></p>}
          <footer className="agentlens-pricing-checkout-actions"><button type="button" disabled={payment.busy} onClick={() => void payment.reopen()}>{renewalOnly ? "Resume original operation" : scheduleAuthorization ? "Continue with Stripe" : "Reopen checkout"}</button><button type="button" disabled={payment.busy} onClick={() => void payment.check()}><FeedbackIcon name="refresh-cw" />{scheduleAuthorization ? "Check Status" : renewalOnly ? "Check status" : "Check payment status"}</button></footer>
        </> : confirmation && <>
        {payment.shortcut ? <>
          <p>{payment.shortcut.kind === "restore" ? "Resume the original automatic renewal. No payment, new period or credits today." : "Cancel only this unpaid reservation. Your current paid coverage remains available. Check Manage billing for the original renewal and any payment reconciliation."}</p>
          {payment.shortcut.snapshot.renewal && <p>Original paid term and next renewal boundary: {new Date(payment.shortcut.snapshot.renewal.periodEnd).toLocaleDateString()}.</p>}
          {payment.shortcut.action && [payment.shortcut.action.summary, payment.shortcut.action.description, payment.shortcut.action.impactDescription].filter((line, index, all) => line && all.indexOf(line) === index).map(line => <p key={line}>{line}</p>)}
          {shortcutFuture && <p>
            {shortcutFuture.kind === "ONE_OFF" ? "Paid future plan" : "Unpaid reservation"}: {plans.find(item => item.id === shortcutFuture.plan.toLowerCase())?.name ?? shortcutFuture.plan} · Starts {new Date(shortcutFuture.effectiveAt).toLocaleDateString()}.
            {shortcutFuture.kind === "ONE_OFF" && <> Restoration cancels this future plan only after success and requests its full actual payment of {shortcutFuture.currency} {shortcutFuture.paidAmount?.toFixed(2)} back. A refund request is not confirmation of bank arrival.</>}
          </p>}
          {payment.shortcut.submitted && <p role="status">The original request was submitted; its outcome may be uncertain. Check status before any further change.</p>}
        </> : reservationCopy ? <p className="agentlens-replacement-explanation">{reservationCopy.body}</p>
          : replacingOrder ? <>
          <p className="agentlens-replacement-explanation">{cancelingRenewal
            ? "We’ll close your pending Stripe authorization first. Your current plan remains active until the end of the subscription term."
            : replacingAuthorization
              ? "We’ll close your pending Stripe authorization before continuing with your new selection."
              : "You have an unpaid order. If you continue, we’ll close it before opening checkout for your new selection."}</p>
          {newOrder && <p className="agentlens-replacement-summary"><strong>New order:</strong><br /><strong>{newOrder.headline}</strong>{newOrder.terms}</p>}
        </> : <div className="agentlens-pricing-checkout-selection"><p>Your current plan remains active until the end of the subscription term.</p></div>}
        {payment.error && <p className="agentlens-parse-error" role="alert">{payment.error} <button type="button" disabled={payment.busy} onClick={() => void payment.reload()}>Retry</button></p>}
        <footer className="agentlens-pricing-checkout-actions"><button type="button" disabled={payment.busy} onClick={cancel}>{replacingOrder || replacingReservation ? "Go back" : "Close"}</button><button type="button" disabled={payment.busy || !payment.ready} onClick={() => void payment.confirm()}>{cancelingRenewal ? "Cancel renewal" : replacingReservation ? "Confirm replacement" : replacingOrder ? "Replace order and continue" : payment.shortcut ? payment.shortcut.submitted ? "Check status" : payment.shortcut.kind === "restore" ? "Confirm resume" : "Confirm cancellation" : "Cancel renewal"}</button></footer>
        </>}
      </WorkbenchDialog>}
      <footer className="agentlens-pricing-footer" aria-label="Payment actions">
        {payment.error && !confirmation && !pendingDialog && <div className="agentlens-parse-error">
          <span role="alert">{payment.error}</span>
          <button type="button" disabled={payment.busy} onClick={() => void payment.reload()}>Retry</button>
        </div>}
        <p className="agentlens-sr-only" aria-live="polite">Selected: <strong>{summary}</strong></p>
        {!isCurrentPlan(selected) && <>
          <p id={paymentFeedbackId} className="agentlens-pricing-payment-feedback" role="status" hidden={!paymentReason}>{paymentReason && `${paymentReason.label}: ${disabledReason(paymentReason.reason)}`}</p>
          <div className={`agentlens-pricing-payments agentlens-pricing-continue${walletCheckout ? " has-wallet" : ""}`}>
            <button type="button" disabled={!canContinue || Boolean(payment.lifecycleActions && selected !== "addon" && !serverCard?.enabled && !cardReason)} aria-controls={cardReason ? paymentFeedbackId : undefined} onClick={event => { if (cardReason) { setShownPaymentReason("card"); return; } purchaseTrigger.current = event.currentTarget; void payment.prepare(selection, walletCheckout ? "card" : undefined); }}>
              {payment.activity === "card" ? "Loading…" : selected === "addon" ? "Check Out" : showCurrentPlan ? "Current plan" : "Subscribe"}
            </button>
            {walletCheckout && <button type="button" className="agentlens-wallet-payment" aria-label={payment.activity === "wallet" ? "Loading…" : "One-off with Alipay / WeChat Pay"} disabled={!canContinue || (!walletAvailable && !walletReason)} aria-controls={walletReason ? paymentFeedbackId : undefined} onClick={event => { if (walletReason) { setShownPaymentReason("wallet"); return; } purchaseTrigger.current = event.currentTarget; void payment.prepare(selection, "wallet"); }}>
              {payment.activity === "wallet" ? "Loading…" : <>
                <span>One-off with</span>
                <span className="agentlens-wallet-payment-methods">
                  <span className="agentlens-wallet-payment-icons"><img src={alipayIcon} alt="" /><img src={wechatPayIcon} alt="" /></span>
                  Pay
                </span>
              </>}
            </button>}
          </div>
          <div className="agentlens-pricing-payment-terms">
            <p>*Subscriptions renew automatically each {paymentPeriod} unless canceled.</p>
            <p>With Alipay or WeChat Pay, you pay once for one {paymentPeriod} of access, with no automatic renewal.</p>
          </div>
        </>}
        {billing && <div className="agentlens-pricing-management">
          <button type="button" disabled={payment.busy} onClick={() => void payment.manage()}>Manage billing</button>
          <button type="button" disabled={payment.busy} onClick={() => void payment.reload()}>Refresh status</button>
        </div>}
      </footer>
    </div>
  </section>;
}
