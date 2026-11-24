import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanSelectionPage } from "@/ui/workbench/PlanSelectionPage";
import type { BillingPort, BillingDashboard, LifecycleAction } from "@/api/billing";
import { useBilling } from "@/ui/workbench/useBilling";
import { AgentLensError } from "@/core/errors";
import type { LifecycleState } from "@/api/billing";

const dashboard: BillingDashboard = { plan: "basic", billingCycle: "monthly", subscriptionStatus: "active", scheduledPlan: null, scheduledBillingCycle: null, scheduledEffectiveAt: null, checkoutStatus: null, fetchReason: null };
function billingFixture(state = dashboard): BillingPort {
  const port: BillingPort = {
    plans: vi.fn().mockResolvedValue(["basic", "pro", "ultra", "mega"].map(plan => ({ plan, priceMonthly: 8, priceYearly: 80, creditsLimit: 500, active: true }))),
    dashboard: vi.fn().mockResolvedValue(state),
    createIntent: vi.fn().mockResolvedValue({ id: "intent-1", displayedAmount: 8, currency: "USD", checkoutStatus: "not_started" }),
    intent: vi.fn().mockResolvedValue({ id: "intent-1", displayedAmount: 8, currency: "USD", checkoutStatus: "pending" }),
    checkout: vi.fn().mockResolvedValue({ checkoutUrl: "https://checkout.stripe.com/pay", status: "pending" }),
    change: vi.fn().mockResolvedValue({ status: "payment_pending", invoiceUrl: "https://invoice.stripe.com/pay", effectiveAt: null }),
    portal: vi.fn().mockResolvedValue({ portalUrl: "https://billing.stripe.com/pay" }),
    subscription: vi.fn().mockResolvedValue(undefined)
  };
  // Simulated server lifecycle; checkout is the test provider, not a legacy fallback.
  port.lifecycleActions = vi.fn(async () => ["PRO", "ULTRA", "MEGA"].flatMap(plan => ["AM", "AY", "OM", "OY"].map(mode => ({plan, mode, action:"NEW", enabled:true, reason:"", stateVersion:1}))) as Awaited<ReturnType<NonNullable<BillingPort["lifecycleActions"]>>>);
  port.lifecycleCheckout = vi.fn(async (id, action) => { const value = await port.checkout(id, action.mode.startsWith("O") ? "wallet" : "card"); return {state:"CHECKOUT_OPEN",checkoutUrl:value.checkoutUrl}; });
  return port;
}

describe("PlanSelectionPage", () => {
  it("keeps payment method reminders visible across selections and unavailable payment methods", async () => {
    const billing = billingFixture();
    billing.lifecycleActions = vi.fn().mockResolvedValue([]);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);

    expect(screen.getByText(/renew automatically each month/)).toBeVisible();
    expect(screen.getByText("With Alipay or WeChat Pay, you pay once for one month of access, with no automatic renewal.")).toBeVisible();
    await screen.findByText("No payment option is available for this selection.");
    expect(screen.getByText(/renew automatically each month/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", {name:/Annual/}));
    for (const name of ["Select Add-on Packs", "Select Ultra"]) {
      fireEvent.click(screen.getByRole("button", {name}));
      expect(screen.getByText(/renew automatically each year/)).toBeVisible();
      expect(screen.getByText("With Alipay or WeChat Pay, you pay once for one year of access, with no automatic renewal.")).toBeVisible();
    }
    expect(billing.createIntent).not.toHaveBeenCalled();
  });

  it("shows the billing error above the payment buttons and clears it after Retry succeeds", async () => {
    const billing = billingFixture();
    vi.mocked(billing.dashboard).mockRejectedValueOnce(new Error("Billing status unavailable"));
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);

    const error = await screen.findByRole("alert");
    const footer = error.closest("footer");
    expect(error).toHaveTextContent("Billing status unavailable");
    expect(footer?.firstElementChild).toContainElement(error);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(billing.dashboard).toHaveBeenCalledTimes(2);
  });

  it.each(["PREPAY", "DOWN_O"])("hides future payment summaries for SCHEDULE and %s", async walletAction => {
    const card = { plan: "PRO", mode: "AY", action: "SCHEDULE", enabled: true, reason: "", stateVersion: 1,
      summary: "", impactDescription: "", description: "Long reservation details." } as const;
    const previousReservation = "Your existing unpaid reservation is canceled before this new payment starts.";
    const billing = billingFixture({
      ...dashboard, plan: walletAction === "PREPAY" ? "pro" : "ultra", billingCycle: "monthly", oneTimePurchase: true
    });
    billing.lifecycleActions = vi.fn(async (): Promise<LifecycleAction[]> => [
      card, { ...card, mode: "OY", action: walletAction, impactDescription: walletAction === "DOWN_O" ? previousReservation : "" }
    ]);
    render(<PlanSelectionPage currentPlan="Pro" billing={billing} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    fireEvent.click(screen.getByRole("button", { name: "Select Pro" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "One-off with Alipay / WeChat Pay" })).toBeEnabled();
    expect(screen.queryByText(/Long reservation details|^Credit Card:\s*$|^Alipay \/ WeChat Pay:\s*$/)).not.toBeInTheDocument();
    expect(screen.queryByText(`Alipay / WeChat Pay: ${previousReservation}`)).not.toBeInTheDocument();
    expect(billing.createIntent).not.toHaveBeenCalled();
  });

  it.each([
    {plan:"ultra", billingCycle:"monthly", subscriptionStatus:"active"},
    {plan:"ultra", billingCycle:"yearly", subscriptionStatus:"active"},
    {plan:"basic", billingCycle:"monthly", subscriptionStatus:"active"},
    {plan:"ultra", billingCycle:"monthly", subscriptionStatus:"canceled"},
  ] as const)("matches Current to the active $plan $billingCycle $subscriptionStatus subscription", async state => {
    const billing = billingFixture({...dashboard, ...state});
    render(<PlanSelectionPage currentPlan={state.plan} onBack={vi.fn()} billing={billing} />);
    fireEvent.click(screen.getByRole("button", {name: "Select Pro"}));
    await waitFor(() => expect(screen.getByRole("button", {name:"Subscribe"})).toBeEnabled());
    const card = screen.getByRole("button", {name:`Select ${state.plan === "basic" ? "Basic" : "Ultra"}`});
    for (const cycle of ["Monthly", "Annual", "Monthly"]) {
      fireEvent.click(screen.getByRole("button", {name:cycle === "Annual" ? /Annual/ : "Monthly"}));
      const expected = state.subscriptionStatus === "active" && (state.plan === "basic" || (cycle === "Annual" ? "yearly" : "monthly") === state.billingCycle);
      expect(Boolean(screen.queryByText("Current", {exact:true}))).toBe(expected);
      expect(card.classList.contains("is-current")).toBe(expected);
      expect(card).toBeEnabled();
      fireEvent.click(card);
      expect(card).toHaveAttribute("aria-pressed", "true");
      expect(Boolean(screen.queryByText(/renew automatically each/))).toBe(!expected);
      expect(Boolean(screen.queryByRole("button", {name: "Subscribe"}))).toBe(!expected);
    }
    expect(billing.createIntent).not.toHaveBeenCalled();
    expect(billing.lifecycleCheckout).not.toHaveBeenCalled();
  });

  it.each(["basic", "pro"] as const)("hides the active %s plan checkout when no card action is returned", async plan => {
    const billing = billingFixture({...dashboard, plan});
    billing.lifecycleActions = vi.fn().mockResolvedValue([
      {plan: "ULTRA", mode: "AM", action: "NEW", enabled: true, reason: "", stateVersion: 1},
    ]);
    render(<PlanSelectionPage currentPlan={plan} onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", {name: "Subscribe"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button", {name: plan === "basic" ? "Select Basic" : "Select Pro"}));
    expect(screen.queryByRole("button", {name: /^(Current plan|Subscribe|One-off with Alipay \/ WeChat Pay)$/})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Manage billing"})).toBeVisible();
    expect(screen.getByRole("button", {name: "Refresh status"})).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name: /Annual/}));
    expect(Boolean(screen.queryByRole("button", {name: "Subscribe"}))).toBe(plan !== "basic");
    expect(billing.createIntent).not.toHaveBeenCalled();
  });

  it("keeps the current card selectable and separates its server payment actions", async () => {
    const billing = billingFixture({...dashboard, plan: "pro", cancelAtPeriodEnd: true});
    billing.lifecycleActions = vi.fn().mockResolvedValue([
      {plan:"PRO",mode:"AM",action:"RESUME",enabled:true,reason:"",stateVersion:2},
      {plan:"PRO",mode:"OY",action:"BLOCK",enabled:false,reason:"BLOCK_AO",stateVersion:2},
      {plan:"PRO",mode:"AY",action:"SCHEDULE",enabled:true,reason:"",stateVersion:2},
    ]);
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    await screen.findByText("Current");
    fireEvent.click(screen.getByRole("button", {name:"Select Pro"}));
    expect(screen.queryByRole("button", {name:"Subscribe"})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Resume renewal"})).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name:/Annual/}));
    await waitFor(() => expect(screen.getByRole("button", {name:"Subscribe"})).toBeEnabled());
    const wallet = screen.getByRole("button", {name:"One-off with Alipay / WeChat Pay"});
    expect(wallet).toBeEnabled();
    expect(screen.queryByText(/one-time purchase at the same tier is unavailable/)).not.toBeInTheDocument();
    fireEvent.click(wallet);
    expect(screen.getByText(/one-time purchase at the same tier is unavailable/)).toBeVisible();
    expect(billing.createIntent).not.toHaveBeenCalled();
    expect(screen.queryByText("Current", {exact:true})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Select Pro"})).not.toHaveClass("is-current");
    fireEvent.click(screen.getByRole("button", {name:"Monthly"}));
    expect(screen.getByText("Current").closest("button")).toHaveAccessibleName("Select Pro");
    expect(billing.createIntent).not.toHaveBeenCalled();
  });

  it.each([
    { plan: "pro", cycle: "monthly", action: "UP_M", futureId: null, notice: "" },
    { plan: "pro", cycle: "monthly", action: "UP_M", futureId: "reservation", notice: "Your existing reservation will be canceled." },
    { plan: "pro", cycle: "yearly", action: "UP_Y", futureId: null, notice: "An annual refund will be processed separately." },
    { plan: "basic", cycle: "monthly", action: "NEW", futureId: null, notice: "Unused Basic credits expire when the new plan starts. You keep your add-on credits." },
  ] as const)("hides payment summaries for $plan $cycle and wallet $action ($futureId)", async ({ plan, cycle, action, futureId, notice }) => {
    const card = { plan: "MEGA", mode: "AM", action: "RESUME", enabled: true, reason: "", stateVersion: 2, resumeIntentId: "original-card", summary: "Continue your original checkout: USD 9.90/month; automatic renewal." } as const;
    const walletSummary = "Pay USD 9.90 now. Starts after payment; no automatic renewal.";
    const baseImpact = "Unused plan credits carry over at activation; add-on credits stay unchanged. Your current monthly payment is not refunded. Current automatic renewal stops only after the new payment succeeds.";
    const wallet: LifecycleAction = {
      ...card, mode: "OM", action, resumeIntentId: null, futureId, summary: walletSummary,
      impactDescription: action === "NEW" ? notice : [baseImpact, notice].filter(Boolean).join(" "),
    };
    const billing = billingFixture({ ...dashboard, plan, billingCycle: cycle });
    billing.lifecycleActions = vi.fn().mockResolvedValue([card, wallet]);
    render(<PlanSelectionPage currentPlan={plan} billing={billing} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Select Mega" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "One-off with Alipay / WeChat Pay" })).toBeEnabled());
    expect(screen.queryByText(`Credit Card: ${card.summary}`)).not.toBeInTheDocument();
    expect(screen.queryByText(`Alipay / WeChat Pay: ${walletSummary}`)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unused plan credits carry over/)).not.toBeInTheDocument();
    if (notice) expect(screen.queryByText(`Alipay / WeChat Pay: ${notice}`)).not.toBeInTheDocument();
    expect(billing.createIntent).not.toHaveBeenCalled();
  });

  it("keeps account dates and the details section out of the checkout layout", async () => {
    const billing = billingFixture({...dashboard, plan:"pro", subscriptionTermEndsAt:"2027-11-03T00:00:00Z", quotaRefreshAt:"2026-12-03T00:00:00Z"});
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", {name:"Subscribe"})).toBeEnabled());
    expect(screen.queryByText(/Current plan details|Current paid term ends:|Current monthly credits refresh:/)).not.toBeInTheDocument();
  });

  it("allows browsing all cards while action loading fails without enabling submissions", async () => {
    const billing = billingFixture();
    billing.lifecycleActions = vi.fn().mockRejectedValue(new Error("Billing actions unavailable"));
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    await screen.findByText(/Payment options are unavailable/);
    for (const name of ["Pro", "Mega", "Basic"]) {
      const card = screen.getByRole("button", {name:`Select ${name}`});
      expect(card).toBeEnabled(); fireEvent.click(card);
      expect(card).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.queryByRole("button", {name:/^(Current plan|Subscribe)$/})).not.toBeInTheDocument();
    expect(billing.createIntent).not.toHaveBeenCalled();
  });
  it.each(["card","wallet"] as const)("opens the chosen %s checkout for a new plan", async method => {
    const billing=billingFixture();billing.paymentOptions=vi.fn().mockResolvedValue({walletAvailable:true});
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    const wallet=await screen.findByRole("button",{name:"One-off with Alipay / WeChat Pay"});
    await waitFor(()=>expect(wallet).toBeEnabled());
    fireEvent.click(screen.getByRole("button",{name:method==="wallet"?"One-off with Alipay / WeChat Pay":"Subscribe"}));
    await waitFor(()=>expect(billing.checkout).toHaveBeenCalledWith("intent-1",method));
    expect(billing.change).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog",{name:"Complete your purchase in Stripe"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Subscribe"})).toBeDisabled();
    expect(wallet).toBeDisabled();
  });
  it("explains an unavailable wallet option on click while leaving card checkout usable", async () => {
    const billing=billingFixture();const actions = await billing.lifecycleActions!(); billing.lifecycleActions=vi.fn().mockResolvedValue(actions!.map(action=>action.mode.startsWith("O") ? {...action,enabled:false,reason:"WORKFLOW_NOT_ENABLED"} : action));
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    const wallet = screen.getByRole("button", { name: "One-off with Alipay / WeChat Pay" });
    await waitFor(() => expect(wallet).toBeEnabled());
    expect(screen.queryByText(/Alipay \/ WeChat Pay: This payment option is not yet available/)).not.toBeInTheDocument();
    fireEvent.click(wallet);
    expect(await screen.findByText(/Alipay \/ WeChat Pay: This payment option is not yet available/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled();
    expect(billing.createIntent).not.toHaveBeenCalled();
  });
  it("rechecks wallet availability before creating an order", async () => {
    const billing=billingFixture();const actions=await billing.lifecycleActions!(); billing.lifecycleActions=vi.fn().mockResolvedValueOnce(actions).mockResolvedValue(actions!.map(action=>action.mode.startsWith("O")?{...action,enabled:false,reason:"WORKFLOW_NOT_ENABLED"}:action));
    const close=vi.fn();vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,close} as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    const wallet=await screen.findByRole("button",{name:"One-off with Alipay / WeChat Pay"});await waitFor(()=>expect(wallet).toBeEnabled());
    fireEvent.click(wallet);
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(wallet).toHaveAccessibleName("One-off with Alipay / WeChat Pay");
    expect(wallet).toHaveAttribute("aria-controls");
    fireEvent.click(wallet);
    expect(screen.getByText(/Alipay \/ WeChat Pay: This payment option is not yet available/)).toBeVisible();
    expect(billing.createIntent).not.toHaveBeenCalled();expect(close).toHaveBeenCalled();
  });
  it("reopens an uncertain wallet checkout with its original order and method", async () => {
    const billing=billingFixture();billing.paymentOptions=vi.fn().mockResolvedValue({walletAvailable:true});
    vi.mocked(billing.checkout).mockRejectedValueOnce(new Error("Network unavailable"));
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    const wallet=await screen.findByRole("button",{name:"One-off with Alipay / WeChat Pay"});await waitFor(()=>expect(wallet).toBeEnabled());fireEvent.click(wallet);
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button",{name:"Reopen checkout"}));
    await waitFor(()=>expect(billing.checkout).toHaveBeenCalledTimes(2));
    expect(billing.checkout).toHaveBeenLastCalledWith("intent-1","wallet");expect(billing.createIntent).toHaveBeenCalledTimes(1);
  });

  it("keeps a server-locked order and reopens its original method", async () => {
    const billing=billingFixture();billing.paymentOptions=vi.fn().mockResolvedValue({walletAvailable:true});
    const message = "A checkout is already open with a different payment method; finish it or wait for it to expire before switching";
    vi.mocked(billing.checkout).mockRejectedValueOnce(new AgentLensError("unknown",message,false,409,undefined,undefined,undefined,"PAYMENT_METHOD_LOCKED"));
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    const wallet=await screen.findByRole("button",{name:"One-off with Alipay / WeChat Pay"});await waitFor(()=>expect(wallet).toBeEnabled());fireEvent.click(wallet);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    fireEvent.click(screen.getByRole("button",{name:"Reopen checkout"}));
    await waitFor(()=>expect(billing.checkout).toHaveBeenCalledTimes(2));
    expect(billing.checkout).toHaveBeenLastCalledWith("intent-1","wallet");expect(billing.createIntent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["WALLET_CHECKOUT_UNAVAILABLE", 503, "Alipay / WeChat Pay is not available for this plan yet"],
    ["STRIPE_PRICE_MISMATCH", 503, "Payment price is not aligned with the selected plan; please contact support"],
    ["STRIPE_PRICE_MISMATCH", 502, "Confirmed price requires verification"],
    ["ONE_TIME_PLAN", 409, "This plan does not renew automatically; purchase again after it expires"],
  ] as const)("shows the server message for %s (HTTP %s)", async (code, status, message) => {
    const billing = billingFixture();
    vi.mocked(billing.checkout).mockRejectedValueOnce(new AgentLensError("unknown", message, false, status, undefined, undefined, undefined, code));
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    const wallet = screen.getByRole("button", { name: "One-off with Alipay / WeChat Pay" });
    await waitFor(() => expect(wallet).toBeEnabled());
    fireEvent.click(wallet);
    expect(within(await screen.findByRole("alert")).getByText(message, { exact: true })).toBeVisible();
  });

  it("allows choosing another pack after canceling the payment dialog", async () => {
    const billing = billingFixture({ ...dashboard, plan: "mega" });
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Mega" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Add-on Packs" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select Add-on Packs" }));
    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Check Out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
    await waitFor(() => expect(billing.createIntent).toHaveBeenCalledTimes(2));
    expect(billing.createIntent).toHaveBeenLastCalledWith({ itemType: "addon", addonCredits: 600 });
  });

  it("automatically confirms payment on return and coalesces focus and visibility events", async () => {
    const billing = billingFixture();
    const refresh = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} onAccountChanged={refresh} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled());
    fireEvent.focus(window);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(billing.intent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    await waitFor(() => expect(billing.intent).toHaveBeenCalledTimes(1));
    vi.mocked(billing.intent).mockResolvedValue({ id: "intent-1", displayedAmount: 8, currency: "USD", checkoutStatus: "paid" });
    vi.mocked(billing.dashboard).mockResolvedValue({ ...dashboard, plan: "ultra" });
    fireEvent.focus(window);
    fireEvent(document, new Event("visibilitychange"));
    await screen.findByRole("dialog", { name: "Payment successful" });
    expect(billing.intent).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
    fireEvent.focus(window);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(billing.intent).toHaveBeenCalledTimes(2);
  });
  it("keeps automatic errors quiet and allows manual status checks after returning", async () => {
    const billing = billingFixture();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    const view = render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    await waitFor(() => expect(billing.intent).toHaveBeenCalledTimes(1));
    vi.mocked(billing.intent).mockClear().mockRejectedValue(new Error("Status unavailable"));
    fireEvent.focus(window);
    await waitFor(() => expect(billing.intent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Complete your purchase in Stripe" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Status unavailable");
    fireEvent.focus(window);
    view.unmount();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(billing.intent).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["Subscribe", "One-off with Alipay / WeChat Pay"],
    ["One-off with Alipay / WeChat Pay", "Subscribe"]
  ])("shows loading on %s while checkout and the browser are pending", async (clickedLabel, otherLabel) => {
    const billing = billingFixture();
    billing.paymentOptions = vi.fn().mockResolvedValue({ walletAvailable: true });
    let resolveCheckout!: (value: Awaited<ReturnType<BillingPort["checkout"]>>) => void;
    let resolveBrowser!: () => void;
    vi.mocked(billing.checkout).mockImplementation(() => new Promise(resolve => { resolveCheckout = resolve; }));
    const openExternal = vi.fn(() => new Promise<void>(resolve => { resolveBrowser = resolve; }));
    vi.stubGlobal("require", (name: string) => name === "electron" ? { shell: { openExternal } } : undefined);
    try {
      render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
      const clickedButton = await screen.findByRole("button", { name: clickedLabel });
      await waitFor(() => expect(clickedButton).toBeEnabled());
      fireEvent.click(clickedButton);
      await waitFor(() => expect(billing.checkout).toHaveBeenCalledTimes(1));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Loading…" })).toBe(clickedButton);
      expect(clickedButton).toBeDisabled();
      expect(screen.getByRole("button", { name: otherLabel })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Pending payment" })).not.toBeInTheDocument();
      await act(async () => { resolveCheckout({ checkoutUrl: "https://checkout.stripe.com/pay", status: "pending" }); });
      expect(openExternal).toHaveBeenCalledWith("https://checkout.stripe.com/pay");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(clickedButton).toHaveTextContent("Loading…");
      await act(async () => { resolveBrowser(); });
      expect(screen.getByRole("dialog", { name: "Complete your purchase in Stripe" })).toBeInTheDocument();
      expect(clickedButton).toHaveAccessibleName(clickedLabel);
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps a failed browser launch on the page and retries the original payment link", async () => {
    const billing = billingFixture();
    const openExternal = vi.fn().mockRejectedValueOnce(new Error("Browser unavailable")).mockResolvedValue(undefined);
    vi.stubGlobal("require", (name: string) => name === "electron" ? { shell: { openExternal } } : undefined);
    try {
      render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Browser unavailable");
      expect(screen.getByRole("alert")).toHaveClass("agentlens-parse-error");
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Reopen checkout" }));
      await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));
      expect(billing.createIntent).toHaveBeenCalledTimes(1);
      expect(billing.lifecycleCheckout).toHaveBeenCalledTimes(2);
      expect(billing.lifecycleCheckout).toHaveBeenLastCalledWith("intent-1", expect.objectContaining({plan:"ULTRA",mode:"AM"}));
    } finally { vi.unstubAllGlobals(); }
  });

  it("confirms server prices, deduplicates checkout and refreshes only after payment is confirmed", async () => {
    const billing = billingFixture();
    const refresh = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} onAccountChanged={refresh} />);
    const card = await screen.findByRole("button", { name: "Subscribe" });
    await waitFor(() => expect(card).toBeEnabled());
    expect(screen.getByText("Ultra - $8.00/month")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Ultra" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(billing.createIntent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Alipay | WeChat Pay" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Refresh billing" })).not.toBeInTheDocument();
    fireEvent.click(card); fireEvent.click(card);
    await screen.findByRole("dialog", { name: "Complete your purchase in Stripe" });
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "Continue to checkout?" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    expect(billing.checkout).toHaveBeenCalledWith("intent-1", "card");
    expect(billing.checkout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.open).mock.results[0]?.value.location.replace).toHaveBeenCalledWith("https://checkout.stripe.com/pay");
    expect(refresh).not.toHaveBeenCalled();
    vi.mocked(billing.intent).mockResolvedValue({ id: "intent-1", displayedAmount: 8, currency: "USD", checkoutStatus: "paid" });
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByText("Waiting for payment confirmation. You can check again after completing payment.");
    expect(screen.queryByRole("dialog", { name: "Payment successful" })).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    vi.mocked(billing.dashboard).mockResolvedValue({ ...dashboard, plan: "ultra" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const successDialog = await screen.findByRole("dialog", { name: "Payment successful" });
    fireEvent.click(within(successDialog).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps failed checkout retry tied to the same add-on intent", async () => {
    const billing = billingFixture();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    vi.mocked(billing.checkout).mockRejectedValueOnce(new Error("Connection lost"));
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Ultra" })).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Select Add-on Packs" }));
    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
    await screen.findByText("Connection lost");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pending payment" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen checkout" }));
    await waitFor(() => expect(billing.checkout).toHaveBeenCalledTimes(2));
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
    expect(billing.createIntent).toHaveBeenCalledWith({ itemType: "addon", addonCredits: 600 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    vi.mocked(billing.intent).mockResolvedValue({ id: "intent-1", displayedAmount: 8, currency: "USD", checkoutStatus: "paid" });
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByRole("dialog", { name: "Your recharge has been successful" });
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps status errors in the yellow alert without showing payment success", async () => {
    const billing = billingFixture();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    vi.mocked(billing.intent).mockRejectedValue(new Error("Status unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    expect(await screen.findByRole("alert")).toHaveClass("agentlens-parse-error");
    expect(screen.getByRole("dialog", { name: "Complete your purchase in Stripe" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Payment successful" })).not.toBeInTheDocument();
  });
  it("restores a pending add-on across navigation and does not infer payment from the current plan", async () => {
    const billing = billingFixture();
    const refresh = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    const first = render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} onAccountChanged={refresh} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Ultra" })).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Select Add-on Packs" }));
    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    first.unmount();
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} onAccountChanged={refresh} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    expect(screen.getByRole("combobox")).toHaveValue("600");
    expect(screen.getByRole("combobox")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByText("Waiting for payment confirmation. You can check again after completing payment.");
    expect(refresh).not.toHaveBeenCalled();
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
    vi.mocked(billing.intent).mockRejectedValue(new AgentLensError("unknown", "Expired", false, 410, undefined, undefined, undefined, "PURCHASE_INTENT_EXPIRED"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByText("This payment link has expired. Check Manage billing for the original payment before purchasing again.");
    expect(screen.queryByRole("button", { name: "Check payment status" })).not.toBeInTheDocument();
  });

  it("distinguishes the current billing cycle from another cycle of the same plan", async () => {
    const billing = billingFixture({...dashboard, plan: "pro"});
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(billing.dashboard).toHaveBeenCalled());
    expect(screen.getByRole("button", {name:"Select Pro"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button", {name:/Annual/}));
    await waitFor(() => expect(screen.getByRole("button", {name:"Select Pro"})).toBeEnabled());
    expect(screen.queryByText("Current", {exact:true})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Select Pro"}));
    expect(screen.getByText("Pro - $80.00/year")).toBeVisible();
    expect(billing.createIntent).not.toHaveBeenCalled();
  });

  it("keeps the selection, cycle and add-on summary synchronized", () => {
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} />);
    expect(screen.queryByText("Current", {exact:true})).not.toBeInTheDocument();
    expect(screen.getByText("Ultra - $6.90/month")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Pro" }));
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    expect(screen.getByText("Pro - $29.90/year")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Choose a pack" }), { target: { value: "600" } });
    expect(screen.getByText("Add-on Packs (600 credits) - $6.90 one-off")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Add-on Packs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Check Out" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /with Alipay \/ WeChat Pay/ })).not.toBeInTheDocument();
  });




});


describe("automatic payment confirmation", () => {
  const selection = { itemType: "subscription", plan: "ultra", billingCycle: "monthly" } as const;
  async function start(billing: BillingPort, refresh = vi.fn()) {
    vi.useFakeTimers();
    vi.spyOn(window, "open").mockReturnValue({ opener:null, closed:false, location:{replace:vi.fn()}, close:vi.fn() } as unknown as Window);
    const view=renderHook(()=>useBilling(billing,"poll-account",refresh));
    await act(async()=>{});
    await act(async()=>{await view.result.current.prepare(selection,"card");});
    return {...view,refresh};
  }
  it("checks immediately, retries transient failures every three seconds and stops after confirmation",async()=>{
    const billing=billingFixture();let state=dashboard;const reads:string[]=[];let checks=0;
    vi.mocked(billing.dashboard).mockImplementation(async()=>{reads.push("dashboard");return state;});
    vi.mocked(billing.intent).mockImplementation(async()=>{
      reads.push("intent");checks++;
      if(checks===2)throw new Error("Temporary network failure");
      if(checks===3)state={...dashboard,plan:"ultra"};
      return {id:"intent-1",displayedAmount:8,currency:"USD",checkoutStatus:checks===3?"paid":"pending"};
    });
    const view=await start(billing);
    try {
      reads.length=0;
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      expect(reads).toEqual(["intent","dashboard"]);expect(view.refresh).not.toHaveBeenCalled();
      await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
      expect(checks).toBe(2);expect(view.result.current.error).toBeNull();expect(view.result.current.pending).not.toBeNull();
      await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
      expect(view.result.current.success).toBe("subscription");expect(view.refresh).toHaveBeenCalledTimes(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(9000);});
      expect(checks).toBe(3);expect(billing.createIntent).toHaveBeenCalledTimes(1);
    } finally {view.unmount();vi.useRealTimers();}
  });
  it("does not overlap slow checks and ignores late responses after leaving the page",async()=>{
    const billing=billingFixture();let resolve!: (value:Awaited<ReturnType<BillingPort["intent"]>>)=>void;
    vi.mocked(billing.intent).mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const view=await start(billing);
    try {
      vi.mocked(billing.dashboard).mockClear();
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      fireEvent.focus(window);fireEvent(document,new Event("visibilitychange"));
      await act(async()=>{await vi.advanceTimersByTimeAsync(9000);});
      expect(billing.intent).toHaveBeenCalledTimes(1);expect(billing.dashboard).not.toHaveBeenCalled();
      view.unmount();
      await act(async()=>{resolve({id:"intent-1",displayedAmount:8,currency:"USD",checkoutStatus:"paid"});});
      await vi.advanceTimersByTimeAsync(9000);
      expect(billing.intent).toHaveBeenCalledTimes(1);expect(billing.dashboard).not.toHaveBeenCalled();expect(view.refresh).not.toHaveBeenCalled();
    } finally {view.unmount();vi.useRealTimers();}
  });
  it.each(["failed","expired","refunded"])("stops on %s without reporting payment success",async status=>{
    const billing=billingFixture();const view=await start(billing);
    try {
      vi.mocked(billing.intent).mockResolvedValue({id:"intent-1",displayedAmount:8,currency:"USD",checkoutStatus:status});
      vi.mocked(billing.dashboard).mockResolvedValue({...dashboard,plan:"ultra"});
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      expect(view.result.current.pending).toBeNull();expect(view.result.current.success).toBeNull();
      expect(view.result.current.notice).toContain(status);
      await act(async()=>{await vi.advanceTimersByTimeAsync(9000);});
      expect(billing.intent).toHaveBeenCalledTimes(1);
    } finally {view.unmount();vi.useRealTimers();}
  });
  it("keeps polling an upgrade while its account state is still catching up",async()=>{
    const billing=billingFixture({...dashboard,plan:"pro"});const view=await start(billing);
    try {
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      expect(view.result.current.pending).not.toBeNull();expect(view.result.current.success).toBeNull();
      vi.mocked(billing.dashboard).mockResolvedValue({...dashboard,plan:"ultra"});
      vi.mocked(billing.intent).mockResolvedValue({id:"intent-1",displayedAmount:8,currency:"USD",checkoutStatus:"paid"});
      await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
      expect(view.result.current.success).toBe("subscription");expect(billing.lifecycleCheckout).toHaveBeenCalledTimes(1);
      expect(billing.change).not.toHaveBeenCalled();expect(view.refresh).toHaveBeenCalledTimes(1);
    } finally {view.unmount();vi.useRealTimers();}
  });
  it("waits until both the paid order and matching plan cycle are applied",async()=>{
    const billing=billingFixture();const view=await start(billing);
    try {
      vi.mocked(billing.intent).mockResolvedValue({id:"intent-1",displayedAmount:8,currency:"USD",checkoutStatus:"paid"});
      vi.mocked(billing.dashboard).mockResolvedValue({...dashboard,plan:"ultra",billingCycle:"yearly"});
      await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
      expect(view.result.current.success).toBeNull();expect(view.refresh).not.toHaveBeenCalled();
      vi.mocked(billing.dashboard).mockResolvedValue({...dashboard,plan:"ultra"});
      await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
      expect(view.result.current.success).toBe("subscription");expect(view.refresh).toHaveBeenCalledTimes(1);
    } finally {view.unmount();vi.useRealTimers();}
  });
});

describe("server billing lifecycle", () => {
  it("uses the server wallet upgrade and retains its intent after a timeout", async () => {
    const action = {plan: "ULTRA", mode: "OM", action: "UP_M", enabled: true, reason: "", stateVersion: 7} as const;
    const billing=billingFixture({...dashboard,plan:"pro"});
    billing.lifecycleActions=vi.fn(async()=>[action,{...action,mode:"AM" as const,enabled:false,reason:"WORKFLOW_NOT_ENABLED"}]);
    billing.lifecycleCheckout=vi.fn().mockRejectedValueOnce(new Error("Lost response")).mockResolvedValue({state:"CHECKOUT_OPEN",checkoutUrl:"https://checkout.stripe.com/original"});
    billing.lifecycleResume=vi.fn(async()=>({state:"CHECKOUT_OPEN",checkoutUrl:"https://checkout.stripe.com/original"}));
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    const wallet=await screen.findByRole("button",{name:"One-off with Alipay / WeChat Pay"});
    await waitFor(()=>expect(wallet).toBeEnabled());
    const card = screen.getByRole("button", { name: "Subscribe" });
    expect(card).toHaveAttribute("aria-controls");
    fireEvent.click(card);
    expect(screen.getByText(/Credit Card: This payment option is not yet available/)).toBeVisible();
    expect(billing.createIntent).not.toHaveBeenCalled();
    fireEvent.click(wallet);
    await waitFor(()=>expect(billing.lifecycleCheckout).toHaveBeenCalledWith("intent-1",action));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Reopen checkout"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button",{name:"Reopen checkout"}));
    await waitFor(()=>expect(billing.lifecycleCheckout).toHaveBeenCalledTimes(2));
    expect(billing.lifecycleCheckout).toHaveBeenLastCalledWith("intent-1",action);
    expect(billing.createIntent).toHaveBeenCalledOnce();expect(billing.checkout).not.toHaveBeenCalled();expect(billing.change).not.toHaveBeenCalled();
  });
});

it("restores the server's pending purchase instead of starting a new checkout", async () => {
  const billing=billingFixture();billing.lifecycleActions=vi.fn(async()=>[]);
  billing.lifecyclePending=vi.fn(async()=>({intentId:"server-original",plan:"ultra",billingCycle:"monthly",mode:"OM",amount:6.9,currency:"USD",state:"CHECKOUT_OPEN"} as const));
  billing.lifecycleResume=vi.fn(async()=>({state:"CHECKOUT_OPEN",checkoutUrl:"https://checkout.stripe.com/original"}));
  vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
  render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
  const reopen=await screen.findByRole("button",{name:"Reopen checkout"});
  await waitFor(()=>expect(reopen).toBeEnabled());fireEvent.click(reopen);
  await waitFor(()=>expect(billing.lifecycleResume).toHaveBeenCalledWith("server-original"));
  expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.checkout).not.toHaveBeenCalled();
});

it("refreshes server actions after confirmed lifecycle payment instead of retaining pre-payment eligibility", async () => {
  vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
  const billing=billingFixture();
  const before={plan:"PRO",mode:"OM",action:"NEW",enabled:true,reason:"",stateVersion:0} as const;
  const after={...before,action:"PREPAY",enabled:false,reason:"WORKFLOW_NOT_ENABLED",stateVersion:4};
  billing.lifecycleActions=vi.fn().mockResolvedValueOnce([before]).mockResolvedValue([after]);
  billing.lifecyclePending=vi.fn().mockResolvedValue({intentId:"confirmed",plan:"pro",billingCycle:"monthly",mode:"OM",amount:2.9,currency:"USD",state:"CHECKOUT_OPEN"});
  billing.lifecycleReconcile=vi.fn().mockResolvedValue({status:"fulfilled"});
  billing.intent=vi.fn().mockResolvedValue({id:"confirmed",displayedAmount:2.9,currency:"USD",checkoutStatus:"paid"});
  billing.dashboard=vi.fn().mockResolvedValue({...dashboard,plan:"pro"});
  const {result}=renderHook(()=>useBilling(billing,"fresh-actions"));
  await waitFor(()=>expect(result.current.pending?.intentId).toBe("confirmed"));
  await waitFor(()=>expect(result.current.busy).toBe(false));
  await act(async()=>{await result.current.check();});
  expect(result.current.success).toBe("subscription");
  expect(result.current.pending).toBeNull();
  expect(result.current.lifecycleActions).toEqual([after]);
});

it("does not show legacy expiry-only guidance for an enabled lifecycle wallet upgrade", async () => {
  const billing=billingFixture({...dashboard,plan:"pro",oneTimePurchase:true});
  billing.lifecycleActions=vi.fn().mockResolvedValue([{plan:"ULTRA",mode:"OM",action:"UP_M",enabled:true,reason:"",stateVersion:4}]);
  render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
  await waitFor(()=>expect(screen.getByRole("button",{name:"One-off with Alipay / WeChat Pay"})).toBeEnabled());
  expect(screen.queryByText(/You can purchase again after it expires/)).not.toBeInTheDocument();
});


it.each([
  ["future_funded", "paid", true],
  ["fulfilled", "paid", false],
  ["future_funded", "pending", false],
  ["future_funded", "refunded", false],
])("handles future funding %s with original order %s without changing current entitlement", async (status, orderStatus, completed) => {
  vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
  const billing=billingFixture();
  billing.lifecycleActions=vi.fn().mockResolvedValue([]);
  billing.lifecyclePending=vi.fn().mockResolvedValueOnce({intentId:"future-original",plan:"pro",billingCycle:"monthly",mode:"OM",amount:2.9,currency:"USD",state:"CHECKOUT_OPEN"}).mockResolvedValue(null);
  billing.lifecycleReconcile=vi.fn().mockResolvedValue({status});
  billing.intent=vi.fn().mockResolvedValue({id:"future-original",displayedAmount:2.9,currency:"USD",checkoutStatus:orderStatus});
  billing.dashboard=vi.fn().mockResolvedValue({...dashboard,plan:"ultra"});
  const {result}=renderHook(()=>useBilling(billing,"future-"+status+orderStatus));
  await waitFor(()=>expect(result.current.pending?.intentId).toBe("future-original"));
  await waitFor(()=>expect(result.current.busy).toBe(false));
  await act(async()=>{await result.current.check();});
  expect(billing.lifecycleReconcile).toHaveBeenCalledWith("future-original");
  expect(result.current.success).toBe(completed ? "subscription" : null);
  expect(result.current.dashboard?.plan).toBe("ultra");
  if(completed){expect(result.current.pending).toBeNull();expect(result.current.notice).toContain("current plan and credits remain unchanged");}
  expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.checkout).not.toHaveBeenCalled();
});


it("shows funded-future guidance inside the success dialog and exposes account management", async () => {
  vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
  const billing=billingFixture({...dashboard,plan:"mega"});
  billing.lifecycleActions=vi.fn().mockResolvedValue([]);
  billing.lifecyclePending=vi.fn().mockResolvedValueOnce({intentId:"future-dialog",plan:"pro",billingCycle:"monthly",mode:"OM",amount:2.9,currency:"USD",state:"CHECKOUT_OPEN"}).mockResolvedValue(null);
  billing.lifecycleReconcile=vi.fn().mockResolvedValue({status:"future_funded"});
  billing.intent=vi.fn().mockResolvedValue({id:"future-dialog",displayedAmount:2.9,currency:"USD",checkoutStatus:"paid"});
  render(<PlanSelectionPage currentPlan="Mega" onBack={vi.fn()} billing={billing} />);
  const check=await screen.findByRole("button",{name:"Check payment status"});
  await waitFor(()=>expect(check).toBeEnabled());fireEvent.click(check);
  const dialog=await screen.findByRole("dialog",{name:"Payment successful"});
  expect(within(dialog).getByText(/Your current plan and credits remain unchanged/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button",{name:"Back"}));
  expect(screen.getByRole("button",{name:"Manage billing"})).toBeEnabled();
});

it("confirms a Schedule reservation without claiming payment or reading an expired intent", async () => {
  const billing=billingFixture({...dashboard,plan:"mega"});
  billing.lifecycleActions=vi.fn().mockResolvedValue([{plan:"ULTRA",mode:"AM",action:"SCHEDULE",enabled:true,reason:"",stateVersion:8}]);
  billing.lifecycleCheckout=vi.fn().mockResolvedValue({state:"SETUP_OPEN",checkoutUrl:"https://checkout.stripe.com/setup"});
  billing.lifecycleReconcile=vi.fn().mockResolvedValue({status:"schedule_ready"});
  billing.intent=vi.fn().mockRejectedValue(new Error("Original selection expired"));
  vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
  render(<PlanSelectionPage currentPlan="Mega" onBack={vi.fn()} billing={billing} />);
  const card=await screen.findByRole("button",{name:"Subscribe"});
  await waitFor(()=>expect(card).toBeEnabled());fireEvent.click(card);
  const authorization = await screen.findByRole("dialog",{name:"Confirm your future plan in Stripe"});
  expect(within(authorization).getByText("You won’t be charged now. Your current plan and credits remain unchanged.")).toBeVisible();
  expect(within(authorization).getByRole("button",{name:"Continue with Stripe"})).toBeVisible();
  const check=within(authorization).getByRole("button",{name:"Check Status"});
  await waitFor(()=>expect(check).toBeEnabled());fireEvent.click(check);
  await screen.findByText(/Your automatic plan is reserved/);
  expect(screen.queryByText("Payment successful")).not.toBeInTheDocument();
  expect(billing.intent).not.toHaveBeenCalled();
});

it("does not confirm a different future plan discovered after the payment click", async () => {
  const billing=billingFixture();
  const displayed={plan:"ULTRA",mode:"AM",action:"UP_M",enabled:true,reason:"",stateVersion:4,description:"Cancel future A after payment and refund USD 2.90",futureId:"future-a"} as const;
  const changed={...displayed,description:"Cancel future B after payment and refund USD 29.90",futureId:"future-b"};
  billing.lifecycleActions=vi.fn().mockResolvedValueOnce([displayed]).mockResolvedValue([changed]);
  billing.lifecycleCheckout=vi.fn();
  vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
  const {result}=renderHook(()=>useBilling(billing,"future-confirmation-changed"));
  await waitFor(()=>expect(result.current.lifecycleActions).toEqual([displayed]));
  await waitFor(()=>expect(result.current.busy).toBe(false));
  await act(async()=>{await result.current.prepare({itemType:"subscription",plan:"ultra",billingCycle:"monthly"},"card");});
  expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.lifecycleCheckout).not.toHaveBeenCalled();
  expect(result.current.lifecycleActions).toEqual([changed]);
  expect(result.current.error).toBeNull();
});

it.each([['schedule_unchanged', 'original reservation remains'], ['replacement_pending', 'reservation change is being checked']])('keeps replacement outcome truthful for %s', async (status, message) => {
  const billing=billingFixture();
  billing.lifecycleActions=vi.fn().mockResolvedValue([]);
  billing.lifecyclePending=vi.fn().mockResolvedValueOnce({intentId:'replace-original',plan:'pro',billingCycle:'yearly',mode:'AY',amount:29.9,currency:'USD',state:'PROVIDER_UNKNOWN'}).mockResolvedValue(null);
  billing.lifecycleReconcile=vi.fn().mockResolvedValue({status});
  const {result}=renderHook(()=>useBilling(billing,'replace-'+status));
  await waitFor(()=>expect(result.current.pending?.intentId).toBe('replace-original'));
  await waitFor(()=>expect(result.current.busy).toBe(false));
  await act(async()=>{await result.current.check();});
  expect(result.current.notice).toContain(message);
  expect(result.current.success).toBeNull();
  expect(Boolean(result.current.pending)).toBe(status==='replacement_pending');
  expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.checkout).not.toHaveBeenCalled();
});

describe("safe checkout replacement", () => {
  const selection = {itemType:"subscription",plan:"pro",billingCycle:"monthly"} as const;
  const action = {plan:"PRO",mode:"OM",action:"NEW",enabled:true,reason:"",stateVersion:5,amountMinor:800,replacesIntentId:"old-checkout",description:"Close the old payment before opening this selection."} as const;
  function replacementBilling() {
    const billing=billingFixture();
    billing.lifecycleActions=vi.fn().mockResolvedValue([action]);
    billing.lifecycleCheckout=vi.fn().mockResolvedValue({state:"CHECKOUT_OPEN",checkoutUrl:"https://checkout.stripe.com/replacement"});
    billing.lifecycleResume=vi.fn().mockResolvedValue({state:"CHECKOUT_OPEN",checkoutUrl:"https://checkout.stripe.com/original"});
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
    return billing;
  }
  it("does not create an intent or close payment until replacement is explicitly confirmed", async () => {
    const billing=replacementBilling();const {result}=renderHook(()=>useBilling(billing,"replace-cancel"));
    await waitFor(()=>expect(result.current.busy).toBe(false));
    await act(async()=>{await result.current.prepare(selection, "wallet");});
    expect(result.current.confirmation).toBe("replace-checkout");expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.lifecycleCheckout).not.toHaveBeenCalled();
    act(()=>result.current.cancel());expect(result.current.confirmation).toBeNull();expect(billing.lifecycleCheckout).not.toHaveBeenCalled();
  });
  it("retains the confirmed intent and old identity after an uncertain response", async () => {
    const billing=replacementBilling();vi.mocked(billing.lifecycleCheckout!).mockRejectedValueOnce(new Error("Response lost"));
    const {result}=renderHook(()=>useBilling(billing,"replace-lost"));await waitFor(()=>expect(result.current.busy).toBe(false));
    await act(async()=>{await result.current.prepare(selection, "wallet");});
    await act(async()=>{await result.current.confirm();});expect(billing.createIntent).toHaveBeenCalledTimes(1);
    expect(result.current.pending?.lifecycleAction?.replacesIntentId).toBe("old-checkout");
    await act(async()=>{await result.current.reopen();});expect(billing.createIntent).toHaveBeenCalledTimes(1);
    expect(billing.lifecycleCheckout).toHaveBeenCalledTimes(2);expect(vi.mocked(billing.lifecycleCheckout!).mock.calls[1]).toEqual(vi.mocked(billing.lifecycleCheckout!).mock.calls[0]);
  });
  it("continues the same selection using its original intent without new checkout submission", async () => {
    const billing=replacementBilling();billing.lifecycleActions=vi.fn().mockResolvedValue([{...action,replacesIntentId:null,resumeIntentId:"original-order",action:"RESUME"}]);
    const {result}=renderHook(()=>useBilling(billing,"same-selection"));await waitFor(()=>expect(result.current.busy).toBe(false));
    await act(async()=>{await result.current.prepare(selection, "wallet");});
    expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.lifecycleCheckout).not.toHaveBeenCalled();expect(billing.lifecycleResume).toHaveBeenCalled();expect(result.current.confirmation).toBeNull();
  });
  it("requires renewed review when terms change while the confirmation is open", async () => {
    const billing=replacementBilling();const {result}=renderHook(()=>useBilling(billing,"replace-changed"));await waitFor(()=>expect(result.current.busy).toBe(false));
    await act(async()=>{await result.current.prepare(selection, "wallet");});
    vi.mocked(billing.lifecycleActions!).mockResolvedValue([{...action,stateVersion:6}]);
    await act(async()=>{await result.current.confirm();});expect(result.current.error).toContain("Billing terms changed");expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.lifecycleCheckout).not.toHaveBeenCalled();
  });
  it("does not report the selected plan paid when the original payment wins the race", async () => {
    const billing=replacementBilling();vi.mocked(billing.lifecycleCheckout!).mockResolvedValue({state:"OLD_PAID",checkoutUrl:null});
    const {result}=renderHook(()=>useBilling(billing,"replace-old-paid"));await waitFor(()=>expect(result.current.busy).toBe(false));
    await act(async()=>{await result.current.prepare(selection, "wallet");});await act(async()=>{await result.current.confirm();});
    expect(result.current.success).toBeNull();expect(result.current.pending).toBeNull();expect(result.current.notice).toContain("original payment was received");
  });
});

it("opens replacement confirmation on the first Subscribe click with the fresh server action", async () => {
  const displayed = { plan: "ULTRA", mode: "AM", action: "NEW", enabled: true, reason: "", stateVersion: 4, amountMinor: 800, summary: "Pay USD 8.00 per month." } as const;
  const replacement = { ...displayed, stateVersion: 5, amountMinor: 900, replacesIntentId: "old-checkout", summary: "Pay USD 9.00 per month." };
  const billing = billingFixture();
  billing.lifecycleActions = vi.fn().mockResolvedValueOnce([displayed]).mockResolvedValue([replacement]);
  billing.createIntent = vi.fn().mockResolvedValue({ id: "replacement-intent", displayedAmount: 9, currency: "USD", checkoutStatus: "not_started" });
  vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
  render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);

  const subscribe = screen.getByRole("button", { name: "Subscribe" });
  await waitFor(() => expect(subscribe).toBeEnabled());
  fireEvent.click(subscribe);

  const dialog = await screen.findByRole("dialog", { name: "Continue with a new order?" });
  expect(dialog).toHaveTextContent("Ultra - US$9/month subscription. Renews automatically");
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  expect(billing.createIntent).not.toHaveBeenCalled();
  expect(billing.lifecycleCheckout).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole("button", { name: "Replace order and continue" }));
  await waitFor(() => expect(billing.lifecycleCheckout).toHaveBeenCalledExactlyOnceWith("replacement-intent", replacement));
  expect(billing.createIntent).toHaveBeenCalledOnce();
});


it.each(["card", "wallet"] as const)("uses Eagle order wording for the selected %s replacement without repeating the plan details", async method => {
  const billing=billingFixture();
  const card={plan:"ULTRA",mode:"AM",action:"SCHEDULE",enabled:true,reason:"",stateVersion:5,amountMinor:290,replacesIntentId:"old-payment",description:"Legacy full card description with Invoice internals",summary:"No charge today. Starts at expiry; USD 2.90/month, with automatic renewal.",impactDescription:"Cancel the unpaid reservation before it starts; no refund is due."} as const;
  const wallet={...card,mode:"OM",action:"PREPAY",description:"Legacy full wallet description",summary:"Pay USD 2.90 now. Starts when your current plan ends; no automatic renewal.",impactDescription:"Cancel before the new plan starts for a refund of the payment."} as const;
  billing.lifecycleActions=vi.fn().mockResolvedValue([card,wallet]);
  billing.lifecycleCheckout=vi.fn();
  render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
  const payButton = await screen.findByRole("button", {name:method==="card"?"Subscribe":"One-off with Alipay / WeChat Pay"});
  await waitFor(() => expect(payButton).toBeEnabled());
  expect(screen.queryByText(`Credit Card: ${card.summary}`)).not.toBeInTheDocument();
  expect(screen.queryByText(`Alipay / WeChat Pay: ${wallet.summary}`)).not.toBeInTheDocument();
  expect(screen.queryByText(/Legacy full/)).not.toBeInTheDocument();
  expect(screen.queryByText(/close the original unpaid checkout/)).not.toBeInTheDocument();
  fireEvent.click(payButton);
  const dialog=await screen.findByRole("dialog",{name:"Continue with a new order?"});
  expect(dialog).toHaveTextContent(method==="card" ? "Ultra - US$2.9/month subscription. Renews automatically" : "Ultra - US$2.9 for one month · No automatic renewal");
  expect(dialog).not.toHaveTextContent(card.summary);
  expect(dialog).not.toHaveTextContent(wallet.summary);
  expect(dialog).not.toHaveTextContent(card.impactDescription);
  expect(dialog).not.toHaveTextContent(wallet.impactDescription);
  expect(dialog).toHaveTextContent("You have an unpaid order. If you continue, we’ll close it before opening checkout for your new selection.");
  fireEvent.click(within(dialog).getByRole("button",{name:"Go back"}));
  expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.lifecycleCheckout).not.toHaveBeenCalled();
});


it("requires review if the server changes short payment copy before submission", async () => {
  const billing=billingFixture();
  const shown={plan:"ULTRA",mode:"AM",action:"NEW",enabled:true,reason:"",stateVersion:5,description:"Original locked description",summary:"Original payment summary"} as const;
  const changed={...shown,summary:"Updated payment summary"};
  billing.lifecycleActions=vi.fn().mockResolvedValueOnce([shown]).mockResolvedValue([changed]);
  billing.lifecycleCheckout=vi.fn();
  const {result}=renderHook(()=>useBilling(billing,"copy-review"));
  await waitFor(()=>expect(result.current.lifecycleActions).toEqual([shown]));
  await waitFor(()=>expect(result.current.busy).toBe(false));
  await act(async()=>{await result.current.prepare({itemType:"subscription",plan:"ultra",billingCycle:"monthly"},"card");});
  expect(result.current.lifecycleActions).toEqual([changed]);expect(result.current.error).toBeNull();
  expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.lifecycleCheckout).not.toHaveBeenCalled();
});

describe("billing snapshot freshness and account isolation", () => {
  function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return {promise, resolve}; }
  it("retains an independently loaded catalog when account data fails, and gates new mutations until retry", async () => {
    const billing = billingFixture();
    vi.mocked(billing.dashboard).mockRejectedValue(new Error("Account status unavailable"));
    const {result} = renderHook(() => useBilling(billing, "freshness"));
    await waitFor(() => expect(result.current.error).toContain("Account status unavailable"));
    expect(result.current.catalog).toHaveLength(4); expect(result.current.ready).toBe(false);
    await act(async () => { await result.current.prepare({itemType: "subscription", plan: "pro", billingCycle: "monthly"}); });
    expect(billing.createIntent).not.toHaveBeenCalled(); expect(billing.subscription).not.toHaveBeenCalled();
    vi.mocked(billing.dashboard).mockResolvedValue(dashboard);
    await act(async () => { await result.current.reload(); });
    expect(result.current.ready).toBe(true); expect(result.current.error).toBeNull();
    vi.mocked(billing.dashboard).mockRejectedValue(new Error("Offline"));
    await act(async () => { await result.current.reload(); });
    expect(result.current.dashboard).toEqual(dashboard); expect(result.current.catalog).toHaveLength(4);
    expect(result.current.ready).toBe(false);
    await act(async () => { await result.current.prepare({itemType: "subscription", plan: "pro", billingCycle: "monthly"}); await result.current.keepCurrent(); });
    expect(billing.createIntent).not.toHaveBeenCalled(); expect(billing.subscription).not.toHaveBeenCalled();
  });
  it("rejects a late A response after A to B to A, without unlocking the new load", async () => {
    const billing = billingFixture();
    const original = deferred<BillingDashboard>(), latest = deferred<BillingDashboard>();
    vi.mocked(billing.dashboard).mockReturnValueOnce(original.promise)
      .mockResolvedValueOnce({...dashboard, plan: "ultra"}).mockReturnValueOnce(latest.promise);
    const {result, rerender} = renderHook(({accountId}) => useBilling(billing, accountId), {initialProps: {accountId: "A"}});
    await waitFor(() => expect(billing.dashboard).toHaveBeenCalledTimes(1));
    rerender({accountId: "B"}); await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.dashboard?.plan).toBe("ultra");
    rerender({accountId: "A"}); await waitFor(() => expect(billing.dashboard).toHaveBeenCalledTimes(3));
    expect(result.current.dashboard).toBeNull(); expect(result.current.ready).toBe(false);
    await act(async () => { original.resolve({...dashboard, plan: "pro"}); });
    expect(result.current.dashboard).toBeNull(); expect(result.current.busy).toBe(true);
    await act(async () => { latest.resolve({...dashboard, plan: "mega"}); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.dashboard?.plan).toBe("mega");
  });
});

it("keeps selection and cycle usable through loading, partial failure and retry", async () => {
  let fail!: (cause: Error) => void;
  const billing = billingFixture();vi.mocked(billing.dashboard).mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));
  render(<PlanSelectionPage currentPlan="Basic" accountId="browse-loading" onBack={vi.fn()} billing={billing} />);
  fireEvent.click(screen.getByRole("button",{name:"Select Pro"}));
  fireEvent.click(screen.getByRole("button",{name:/Annual/}));
  expect(screen.getByRole("button",{name:"Select Pro"})).toHaveAttribute("aria-pressed","true");
  expect(screen.getByRole("button",{name:/^(Check Out|Credit Card|Subscribe|Loading…)$/})).toBeDisabled();
  await act(async()=>{fail(new Error("Offline"));});
  await screen.findByRole("alert");expect(screen.getByText(/Cached billing information/)).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Select Mega"}));
  expect(billing.createIntent).not.toHaveBeenCalled();
  vi.mocked(billing.dashboard).mockResolvedValue(dashboard);
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Subscribe"})).toBeEnabled());
  expect(screen.getByRole("button",{name:"Select Mega"})).toHaveAttribute("aria-pressed","true");
  expect(screen.getByRole("button",{name:/Annual/})).toHaveAttribute("aria-pressed","true");
});


describe("authoritative billing and renewal shortcuts", () => {
  const restoreAction = {plan:"PRO", mode:"AM", action:"RESUME", enabled:true, reason:"", stateVersion:5, futureId:"future-one", description:"Cancel the paid future plan and request its full refund before restoring renewal."} as const;
  const snapshot: LifecycleState = {stateVersion:5, renewal:{plan:"PRO",mode:"AM",periodEnd:"2027-01-01T00:00:00Z",canceled:true,restoreAvailable:true}, future:{id:"future-one",kind:"ONE_OFF",state:"READY",plan:"ULTRA",mode:"OY",effectiveAt:"2027-01-01T00:00:00Z",paidAmount:69.9,currency:"USD"}};
  function renewalBilling() {
    const billing=billingFixture({...dashboard,plan:"pro",cancelAtPeriodEnd:true});
    billing.lifecycleActions=vi.fn().mockResolvedValue([restoreAction]);
    billing.lifecycleState=vi.fn().mockResolvedValue(snapshot);
    billing.lifecycleRestoreRenewal=vi.fn().mockResolvedValue({status:"COMPLETED"});
    billing.lifecycleCancelFuture=vi.fn().mockResolvedValue({status:"CANCELED"});
    return billing;
  }
  it.each([null, new Error("Offline")])("never submits a plan through old rules when actions are absent (%s)", async value => {
    const billing=billingFixture();billing.lifecycleActions=value instanceof Error ? vi.fn().mockRejectedValue(value) : vi.fn().mockResolvedValue(value);
    const view=renderHook(()=>useBilling(billing,"no-fallback"));
    await waitFor(()=>expect(view.result.current.ready).toBe(true));
    await act(async()=>{await view.result.current.prepare({itemType:"subscription",plan:"ultra",billingCycle:"yearly"},"card");});
    expect(view.result.current.error).toContain("Payment options are unavailable");
    expect(billing.createIntent).not.toHaveBeenCalled();expect(billing.change).not.toHaveBeenCalled();expect(billing.checkout).not.toHaveBeenCalled();
  });
  it("uses server permission for annual upgrades without a local yearly block", async()=>{
    const billing=billingFixture({...dashboard,plan:"pro",billingCycle:"yearly"});
    render(<PlanSelectionPage currentPlan="Pro" billing={billing} onBack={vi.fn()} />);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Subscribe"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button",{name:/Annual/}));
    expect(screen.getByRole("button",{name:"Subscribe"})).toBeEnabled();
    expect(screen.queryByText(/credit for unused subscription time/)).not.toBeInTheDocument();
  });
  it("shows Basic cancellation as a server action and never creates a Basic order by browsing", async()=>{
    const billing=billingFixture({...dashboard,plan:"pro"});
    billing.lifecycleActions=vi.fn().mockResolvedValue([{plan:"BASIC",mode:"BASIC",action:"CANCEL_A",enabled:true,reason:"",stateVersion:2}]);
    render(<PlanSelectionPage currentPlan="Pro" billing={billing} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button",{name:"Select Basic"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Subscribe"})).toBeEnabled());
    expect(screen.queryByRole("button",{name:/with Alipay/})).not.toBeInTheDocument();expect(billing.createIntent).not.toHaveBeenCalled();
  });
  it("requires combined future refund confirmation before restoring renewal", async()=>{
    const billing=renewalBilling();
    render(<PlanSelectionPage currentPlan="Pro" billing={billing} onBack={vi.fn()} />);
    const resume=await screen.findByRole("button",{name:"Resume renewal"});await waitFor(()=>expect(resume).toBeEnabled());fireEvent.click(resume);
    const dialog=await screen.findByRole("dialog",{name:"Resume original subscription?"});
    expect(within(dialog).getByText(/USD 69.90/)).toBeVisible();expect(within(dialog).getByText(/not confirmation of bank arrival/)).toBeVisible();
    expect(billing.lifecycleRestoreRenewal).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button",{name:"Confirm resume"}));
    await waitFor(()=>expect(billing.lifecycleRestoreRenewal).toHaveBeenCalledWith(expect.objectContaining({stateVersion:5,futureId:"future-one",confirmed:true,requestKey:expect.any(String)})));
    expect(billing.subscription).not.toHaveBeenCalled();expect(billing.createIntent).not.toHaveBeenCalled();
  });
  it("rejects changed future terms after the confirmation is shown", async()=>{
    const billing=renewalBilling();const view=renderHook(()=>useBilling(billing,"future-changed"));
    await waitFor(()=>expect(view.result.current.canRestoreRenewal).toBe(true));
    await act(async()=>{await view.result.current.keepCurrent("restore");});
    vi.mocked(billing.lifecycleState!).mockResolvedValue({...snapshot,stateVersion:6});
    await act(async()=>{await view.result.current.confirm();});
    expect(view.result.current.error).toContain("Billing terms changed");expect(billing.lifecycleRestoreRenewal).not.toHaveBeenCalled();
  });
  it("retains an uncertain restoration across remounts without resubmitting", async()=>{
    const billing=renewalBilling();vi.mocked(billing.lifecycleRestoreRenewal!).mockRejectedValue(new Error("Lost response"));
    const first=renderHook(()=>useBilling(billing,"uncertain-restore"));await waitFor(()=>expect(first.result.current.canRestoreRenewal).toBe(true));
    await act(async()=>{await first.result.current.keepCurrent("restore");});await act(async()=>{await first.result.current.confirm();});first.unmount();
    const second=renderHook(()=>useBilling(billing,"uncertain-restore"));await waitFor(()=>expect(second.result.current.ready).toBe(true));
    await act(async()=>{await second.result.current.keepCurrent("restore");});await act(async()=>{await second.result.current.confirm();});
    expect(billing.lifecycleRestoreRenewal).toHaveBeenCalledTimes(1);expect(second.result.current.notice).toContain("original request has been checked");
  });
  it("cancels only a server-authorized unpaid reservation through the dedicated endpoint", async()=>{
    const billing=renewalBilling();billing.lifecycleState=vi.fn().mockResolvedValue({...snapshot,future:{...snapshot.future!,kind:"SCHEDULE",cancelAvailable:true}});
    const view=renderHook(()=>useBilling(billing,"cancel-reservation"));await waitFor(()=>expect(view.result.current.canCancelReservation).toBe(true));
    await act(async()=>{await view.result.current.keepCurrent("cancel-reservation");});expect(billing.lifecycleCancelFuture).not.toHaveBeenCalled();
    await act(async()=>{await view.result.current.confirm();});expect(billing.lifecycleCancelFuture).toHaveBeenCalledWith("future-one",5);expect(billing.subscription).not.toHaveBeenCalled();
  });
});

describe("unfinished authorization and reservation replacement (1124 Dev feedback)", () => {
  const waiting: LifecycleAction = {plan:"PRO",mode:"AM",action:"SCHEDULE",enabled:true,reason:"",stateVersion:7,
    futureId:"authorization",resumeIntentId:"original"};
  const replacement: LifecycleAction = {plan:"PRO",mode:"OM",action:"DOWN_O",enabled:true,reason:"",stateVersion:7,
    replacesIntentId:"authorization",replacesAuthorization:true,amountMinor:800};

  it("keeps recovered authorization available without opening a dialog automatically", async () => {
    vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
    const billing=billingFixture({...dashboard,plan:"ultra"});
    billing.lifecycleActions=vi.fn(async()=>[waiting,replacement]);
    billing.lifecyclePending=vi.fn(async()=>({intentId:"original",plan:"pro",billingCycle:"monthly",mode:"AM",amount:0,currency:"USD",state:"AWAITING_AUTHORIZATION",action:"SCHEDULE"} as const));
    billing.intent=vi.fn().mockResolvedValue({id:"original",displayedAmount:8,currency:"USD",checkoutStatus:"pending"});
    billing.lifecycleResume=vi.fn().mockResolvedValue({state:"SETUP_OPEN",checkoutUrl:"https://checkout.stripe.com/original"});
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);

    const mount=()=>render(<PlanSelectionPage currentPlan="Ultra" accountId="authorization-retest" billing={billing} onBack={vi.fn()}/>);
    const {unmount}=mount();
    const continuation=await screen.findByRole("button",{name:"Continue authorization"});
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(continuation);
    const authorization=await screen.findByRole("dialog",{name:"Confirm your future plan in Stripe"});
    fireEvent.keyDown(authorization,{key:"Escape"});
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    unmount();mount();
    await screen.findByRole("button",{name:"Continue authorization"});
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button",{name:"Select Pro"}));
    const wallet=screen.getByRole("button",{name:"One-off with Alipay / WeChat Pay"});
    await waitFor(()=>expect(wallet).toBeEnabled());fireEvent.click(wallet);
    const confirmation=await screen.findByRole("dialog",{name:"Continue with a new order?"});
    expect(confirmation).toHaveTextContent("We’ll close your pending Stripe authorization before continuing with your new selection.");
    expect(billing.createIntent).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button",{name:"Go back"}));
    fireEvent.click(screen.getByRole("button",{name:"Subscribe"}));
    await waitFor(()=>expect(billing.lifecycleResume).toHaveBeenCalledExactlyOnceWith("original"));
    expect(billing.createIntent).not.toHaveBeenCalled();
  });

  it("reopens the original authorization on the first click after stale displayed actions", async () => {
    const billing=billingFixture({...dashboard,plan:"ultra"});
    const {resumeIntentId: _resume, futureId: _future, ...before}=waiting;
    billing.lifecycleActions=vi.fn().mockResolvedValueOnce([before]).mockResolvedValue([waiting]);
    billing.intent=vi.fn().mockResolvedValue({id:"original",displayedAmount:8,currency:"USD",checkoutStatus:"pending"});
    billing.lifecycleResume=vi.fn().mockResolvedValue({state:"SETUP_OPEN",checkoutUrl:"https://checkout.stripe.com/original"});
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
    render(<PlanSelectionPage currentPlan="Ultra" billing={billing} onBack={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Select Pro"}));
    const subscribe=screen.getByRole("button",{name:"Subscribe"});
    await waitFor(()=>expect(subscribe).toBeEnabled());fireEvent.click(subscribe);
    await waitFor(()=>expect(billing.lifecycleResume).toHaveBeenCalledExactlyOnceWith("original"));
    expect(billing.createIntent).not.toHaveBeenCalled();
  });

  it("asks for confirmation before closing authorization and canceling renewal", async () => {
    const billing=billingFixture({...dashboard,plan:"ultra"});
    const action: LifecycleAction={plan:"BASIC",mode:"BASIC",action:"CANCEL_A",enabled:true,reason:"",stateVersion:7,replacesIntentId:"authorization",replacesAuthorization:true,amountMinor:0};
    billing.lifecycleActions=vi.fn(async()=>[action]);
    billing.createIntent=vi.fn().mockResolvedValue({id:"new-intent",displayedAmount:0,currency:"USD",checkoutStatus:"not_started"});
    billing.lifecycleCheckout=vi.fn().mockResolvedValue({state:"renewal_canceled",checkoutUrl:null});
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,location:{replace:vi.fn()},close:vi.fn()} as unknown as Window);
    render(<PlanSelectionPage currentPlan="Ultra" billing={billing} onBack={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Select Basic"}));
    const subscribe=screen.getByRole("button",{name:"Subscribe"});
    await waitFor(()=>expect(subscribe).toBeEnabled());fireEvent.click(subscribe);
    const dialog=await screen.findByRole("dialog",{name:"Cancel renewal?"});
    expect(billing.createIntent).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button",{name:"Cancel renewal"}));
    await waitFor(()=>expect(billing.lifecycleCheckout).toHaveBeenCalledExactlyOnceWith("new-intent",action));
  });

  const reservation: NonNullable<LifecycleState["future"]> = {
    id: "ultra", kind: "SCHEDULE", state: "READY", plan: "ULTRA", mode: "AM",
    effectiveAt: new Date(2026, 11, 24, 12).toISOString(),
  };
  const reservationAction: LifecycleAction = {
    plan: "PRO", mode: "AM", action: "SCHEDULE", enabled: true, reason: "", stateVersion: 7,
    futureId: "ultra", amountMinor: 290,
    description: "Replace existing reservation ULTRA / AM (USD 6.90) with PRO / AM at 2026-12-24T07:35:17Z. The original Invoice recovery process applies.",
  };

  // Copy approved by the user in the Nov 24 follow-up to the Dev billing report.
  it("renders only the approved reservation copy and submits only after explicit confirmation", async () => {
    const billing=billingFixture({...dashboard,plan:"mega",scheduledPlan:"ultra",scheduledEffectiveAt:"2027-01-01T12:00:00Z"});
    billing.lifecycleActions=vi.fn(async()=>[reservationAction]);
    billing.lifecycleState=vi.fn(async()=>({stateVersion:7,future:reservation,renewal:null}));
    billing.createIntent=vi.fn().mockResolvedValue({id:"new-intent",displayedAmount:2.9,currency:"USD",checkoutStatus:"not_started"});
    billing.lifecycleCheckout=vi.fn().mockResolvedValue({state:"VERIFIED",checkoutUrl:null});
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,close:vi.fn()} as unknown as Window);

    render(<PlanSelectionPage currentPlan="Mega" billing={billing} onBack={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Select Pro"}));
    const subscribe=screen.getByRole("button",{name:"Subscribe"});
    await waitFor(()=>expect(subscribe).toBeEnabled());
    fireEvent.click(subscribe);
    const title = "Replace Ultra with Pro?";
    const dialog = await screen.findByRole("dialog",{name:title});
    expect(within(dialog).getByRole("heading",{name:title})).toBeVisible();
    expect([...dialog.querySelectorAll("p")].map(p=>p.textContent)).toEqual([
      "Pro is scheduled to start on Dec 24, 2026. You won’t be charged today.",
    ]);
    expect(within(dialog).getByRole("button",{name:"Close dialog"})).toBeVisible();
    expect(within(dialog).getByRole("button",{name:"Confirm replacement"})).toBeVisible();
    expect(within(dialog).getAllByRole("button")).toHaveLength(3);
    expect(dialog).not.toHaveTextContent(reservationAction.description!);
    expect(billing.createIntent).not.toHaveBeenCalled();
    expect(billing.lifecycleCheckout).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button",{name:"Go back"}));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(billing.createIntent).not.toHaveBeenCalled();
    expect(billing.lifecycleCheckout).not.toHaveBeenCalled();

    fireEvent.click(subscribe);
    const second = await screen.findByRole("dialog",{name:title});
    fireEvent.click(within(second).getByRole("button",{name:"Confirm replacement"}));
    await waitFor(()=>expect(billing.lifecycleCheckout).toHaveBeenCalledExactlyOnceWith("new-intent",reservationAction));
    expect(billing.createIntent).toHaveBeenCalledOnce();
  });

  it("requires the reservation snapshot to match the current action before opening the dialog", async () => {
    const billing=billingFixture({...dashboard,plan:"mega",scheduledPlan:"ultra"});
    billing.lifecycleActions=vi.fn(async()=>[reservationAction]);
    billing.lifecycleState=vi.fn().mockResolvedValueOnce({stateVersion:7,future:reservation,renewal:null})
      .mockResolvedValue({stateVersion:8,future:null,renewal:null});
    billing.lifecycleCheckout=vi.fn();
    vi.spyOn(window,"open").mockReturnValue({opener:null,closed:false,close:vi.fn()} as unknown as Window);

    render(<PlanSelectionPage currentPlan="Mega" billing={billing} onBack={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Select Pro"}));
    const subscribe=screen.getByRole("button",{name:"Subscribe"});
    await waitFor(()=>expect(subscribe).toBeEnabled());fireEvent.click(subscribe);
    expect(await screen.findByRole("alert")).toHaveTextContent("This payment option is unavailable. Refresh the available actions.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(billing.createIntent).not.toHaveBeenCalled();
    expect(billing.lifecycleCheckout).not.toHaveBeenCalled();
  });
});
