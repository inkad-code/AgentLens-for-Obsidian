import { useRef, useState } from "react";
import { billingAssets } from "./billingAssets";
import { billingAction, hasActiveSubscription, type BillingPort, type BillingPlan, type PurchaseSelection } from "../../api/billing";
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
const money = (value: number) => `$${value.toFixed(2)}`;

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
  const [selected, setSelected] = useState(payment.pending?.selection.itemType === "addon" ? "addon" : payment.pending?.selection.plan ?? "ultra");
  const [packCredits, setPackCredits] = useState(payment.pending?.selection.addonCredits ?? 200);
  const pack = packs.find(item => item.credits === packCredits) ?? packs[0];
  const plan = plans.find(item => item.id === selected) ?? plans[2];
  const price = (item: typeof plans[number]) => {
    const live = payment.catalog?.find(config => config.plan === item.id && config.active);
    return live ? (cycle === "monthly" ? live.priceMonthly : live.priceYearly) : item[cycle];
  };
  const summary = selected === "addon" ? `Add-on Packs (${pack.credits} credits) — ${money(pack.price)} one-off` : `${plan.name} — ${plan.id === "basic" ? "Free" : `${money(price(plan))}/${cycle === "monthly" ? "month" : "year"}`}`;
  const selection: PurchaseSelection = selected === "addon" ? { itemType: "addon", addonCredits: packCredits } : { itemType: "subscription", plan: selected as BillingPlan, billingCycle: selected === "basic" || cycle === "monthly" ? "monthly" : "yearly" };
  const action = payment.dashboard ? (selected === "addon" ? (hasActiveSubscription(payment.dashboard) ? "checkout" : "unavailable") : billingAction(payment.dashboard, selected as BillingPlan, selection.billingCycle!)) : "unavailable";
  const annualSelectionBlocked = action === "upgrade" && payment.dashboard?.billingCycle === "yearly" && selection.billingCycle === "yearly";
  const canContinue = Boolean(billing && payment.catalog && payment.dashboard && !annualSelectionBlocked && !payment.busy && !(payment.pending && payment.pendingOpen) && !payment.confirmation && (selected === "addon" || payment.catalog.some(item => item.plan === selected && item.active)) && ["checkout", "upgrade", "schedule-change"].includes(action));
  const confirmation = payment.confirmation;
  const termEnd = payment.dashboard?.subscriptionTermEndsAt;
  const termDate = termEnd && !Number.isNaN(Date.parse(termEnd)) ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(termEnd)) : "the end of your current subscription term";
  const pendingDialog = Boolean(payment.pending && payment.pendingOpen);
  const currentPlanLabel = plans.find(item => item.id === activePlan)?.name ?? currentPlan;
  const scheduledDate = payment.dashboard?.scheduledEffectiveAt;
  const renewalDate = new Date();
  if (selection.billingCycle === "yearly") renewalDate.setFullYear(renewalDate.getFullYear() + 1);
  else renewalDate.setMonth(renewalDate.getMonth() + 1);
  const actionDescription = action === "schedule-change" ? `Your current ${currentPlanLabel} plan stays active until ${termDate}.` : action === "upgrade" ? "Your new plan starts after payment and the plan change are confirmed." : action === "current" ? "This is already your current plan." : action === "scheduled" ? "This plan change is already scheduled." : "Stripe checkout opens when you click Check Out.";

  function indicator(id: string) {
    return <span className="agentlens-pricing-indicator" aria-hidden="true"><img src={selected === id ? billingAssets.selectedCircle : billingAssets.circle} width="20" height="20" alt="" />{selected === id && <span>✓</span>}</span>;
  }
  return <section className="agentlens-pricing-page" aria-label="Choose a plan">
    <button className="agentlens-pricing-back" type="button" onClick={onBack}><img src={billingAssets.back} width="18" height="18" alt="" /><span>Back</span></button>
    <div className="agentlens-pricing-content">
      <fieldset className="agentlens-pricing-selection" disabled={Boolean(payment.confirmation || pendingDialog || payment.busy)}>
      <div className="agentlens-pricing-cycle" role="group" aria-label="Billing cycle">
        <button type="button" aria-pressed={cycle === "monthly"} onClick={() => setCycle("monthly")}>Monthly</button>
        <button type="button" aria-pressed={cycle === "annual"} onClick={() => setCycle("annual")}>Annual <span>save ~16%</span></button>
      </div>
      <div className="agentlens-pricing-grid">
        {plans.map(item => <button key={item.id} type="button" className={`agentlens-pricing-card${selected === item.id ? " is-selected" : ""}${item.id === "basic" ? " is-basic" : ""}`} aria-pressed={selected === item.id} aria-label={`Select ${item.name}`} onClick={() => setSelected(item.id)}>
          {indicator(item.id)}
          {item.id === "ultra" && <span className="agentlens-pricing-popular">Most Popular</span>}
          <span className="agentlens-pricing-heading"><span className="agentlens-pricing-title">{item.name}{activePlan === item.id && <span className="agentlens-pricing-current">Current</span>}</span><span className="agentlens-pricing-description">{item.description}</span></span>
          <span className="agentlens-pricing-price"><strong>{item.id === "basic" ? "Free" : money(price(item))}</strong>{item.id !== "basic" && <span>/ {cycle === "monthly" ? "month" : "year"}</span>}</span>
          <span className="agentlens-pricing-details"><span className="agentlens-pricing-credits"><span>Credits</span><strong>{payment.catalog?.find(config => config.plan === item.id)?.creditsLimit.toLocaleString("en-US") ?? item.credits} / month</strong></span><span className="agentlens-pricing-features">{["All 20+ supported platforms", "Credits refresh every month", item.support].map(feature => <span key={feature}><i aria-hidden="true">✓</i>{feature}</span>)}</span></span>
        </button>)}
        <div className={`agentlens-pricing-card${selected === "addon" ? " is-selected" : ""}`}>
          <button className="agentlens-pricing-addon-select" type="button" aria-label="Select Add-on Packs" aria-pressed={selected === "addon"} onClick={() => setSelected("addon")}>{indicator("addon")}<span className="agentlens-pricing-heading"><span className="agentlens-pricing-title">Add-on Packs</span><span className="agentlens-pricing-description">Extra credits, on demand</span></span><span className="agentlens-pricing-price"><strong>{money(pack.price)}</strong><span>one-off</span></span></button>
          <div className="agentlens-pricing-details"><label className="agentlens-pricing-pack">Choose a pack<select style={{ backgroundImage: `url(${billingAssets.chevron})`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }} aria-label="Choose a pack" value={packCredits} onChange={event => { setPackCredits(Number(event.target.value)); setSelected("addon"); }}>{packs.map(item => <option key={item.credits} value={item.credits}>{item.credits.toLocaleString("en-US")} credits</option>)}</select></label><div className="agentlens-pricing-features">{["All 20+ supported platforms", "Add-on credits never expire"].map(feature => <span key={feature}><i aria-hidden="true">✓</i>{feature}</span>)}</div></div>
        </div>
      </div>
      </fieldset>
      <div className="agentlens-pricing-summary" aria-live="polite"><p>Selected: <strong>{summary}</strong></p><p>{actionDescription}</p>{action === "upgrade" && <>
        <p>Current plan: <strong>{currentPlanLabel} — {payment.dashboard?.billingCycle === "yearly" ? "Annual" : "Monthly"}</strong></p>
        <p>Today's displayed charge: <strong>{money(price(plan))}</strong>{annualSelectionBlocked ? " before the required unused annual-term credit" : ""}.</p>
        <p>Estimated new renewal date and first-month credit expiry: <strong>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(renewalDate)}</strong>.</p>
        {payment.dashboard?.includedCreditsBalance !== undefined && payment.dashboard.addonCreditsBalance !== undefined && <p>First-month included credits retain <strong>{payment.dashboard.includedCreditsBalance.toLocaleString("en-US")}</strong> unused current-plan credits; <strong>{payment.dashboard.addonCreditsBalance.toLocaleString("en-US")}</strong> add-on credits stay unchanged.</p>}
        {payment.dashboard?.scheduledPlan && <p>The immediate upgrade will cancel the scheduled change to <strong>{plans.find(item => item.id === payment.dashboard?.scheduledPlan)?.name}</strong>.</p>}
      </>}{["checkout", "upgrade"].includes(action) && <p>Stripe opens in your browser. Keep this page open to check your payment status.</p>}</div>
      {payment.dashboard?.scheduledPlan && <div className="agentlens-pricing-scheduled"><p role="status">Changes to <strong>{plans.find(item => item.id === payment.dashboard?.scheduledPlan)?.name} {payment.dashboard.scheduledBillingCycle === "yearly" ? "Annual" : "Monthly"}</strong> on <strong>{scheduledDate ? new Date(scheduledDate).toLocaleDateString() : "the end of the current subscription term"}</strong>.</p><button type="button" disabled={payment.busy} onClick={() => void payment.keepCurrent()}>Keep {currentPlanLabel}</button></div>}
      {payment.dashboard?.cancelAtPeriodEnd && <div className="agentlens-pricing-scheduled"><p role="status">Renewal canceled. Your current {currentPlanLabel} plan remains active until {termDate}.</p>{!payment.dashboard.scheduledPlan && <button type="button" disabled={payment.busy} onClick={() => void payment.keepCurrent()}>Keep {currentPlanLabel}</button>}</div>}
      {action === "unavailable" && payment.dashboard && <p role="status">{selected === "addon" ? "An active plan is required before adding credits." : "This change is currently unavailable. Manage billing for subscription options."}</p>}
      {annualSelectionBlocked && <p className="agentlens-parse-error" role="status">The credit for unused subscription time isn't available for this upgrade yet. No payment will be started. Contact Support for help.</p>}
      {payment.error && !confirmation && !pendingDialog && <p className="agentlens-parse-error" role="alert">{payment.error}</p>}
      {payment.notice && !pendingDialog && <p role="status">{payment.notice}</p>}
      {payment.pending && !pendingDialog && !payment.busy && <button type="button" onClick={event => { purchaseTrigger.current = event.currentTarget; payment.showPending(); }}>View pending payment</button>}
      <div className="agentlens-pricing-payments agentlens-pricing-continue"><button type="button" disabled={!canContinue} onClick={event => { purchaseTrigger.current = event.currentTarget; void payment.prepare(selection); }}>{payment.busy ? "Loading…" : "Check Out"}</button></div>
      {payment.success && <WorkbenchDialog title={payment.success === "addon" ? "Your recharge has been successful" : "Payment successful"} textClose closeOnBackdrop className="agentlens-pricing-checkout-dialog agentlens-billing-result-dialog agentlens-billing-success-dialog" onClose={cancel}>
        <span className="agentlens-billing-success-icon" aria-hidden="true"><FeedbackIcon name="check" /></span>
        <footer className="agentlens-pricing-checkout-actions"><button type="button" onClick={cancel}>Back</button></footer>
      </WorkbenchDialog>}
      {(confirmation || pendingDialog) && <WorkbenchDialog title={pendingDialog ? "Complete your purchase in Stripe" : "Cancel renewal?"} hideClose={pendingDialog} textClose closeOnBackdrop className={`agentlens-pricing-checkout-dialog${pendingDialog ? " agentlens-billing-result-dialog" : ""}`} onClose={cancel}>
        {pendingDialog ? <>
          <p className="agentlens-pricing-checkout-subtitle">We'll update your plan after payment is confirmed.</p>
          {payment.notice && <p role="status">{payment.notice}</p>}
          {payment.error && <p className="agentlens-parse-error" role="alert">{payment.error}</p>}
          <footer className="agentlens-pricing-checkout-actions"><button type="button" disabled={payment.busy} onClick={() => void payment.reopen()}>Reopen checkout</button><button type="button" disabled={payment.busy} onClick={() => void payment.check()}><FeedbackIcon name="refresh-cw" />Check payment status</button></footer>
        </> : confirmation && <>
        <div className="agentlens-pricing-checkout-selection"><p>Keep {currentPlanLabel} until {termDate}, then cancel the paid subscription.</p></div>
        {payment.error && <p className="agentlens-parse-error" role="alert">{payment.error}</p>}
        <footer className="agentlens-pricing-checkout-actions"><button type="button" disabled={payment.busy} onClick={cancel}>Cancel</button><button type="button" disabled={payment.busy} onClick={() => void payment.confirm()}>{payment.busy ? "Starting…" : "Cancel renewal"}</button></footer>
        </>}
      </WorkbenchDialog>}
    </div>
  </section>;
}
