import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanSelectionPage } from "@/ui/workbench/PlanSelectionPage";
import type { BillingPort, BillingDashboard } from "@/api/billing";
import { AgentLensError } from "@/core/errors";

const dashboard: BillingDashboard = { plan: "basic", billingCycle: "monthly", subscriptionStatus: "active", scheduledPlan: null, scheduledBillingCycle: null, scheduledEffectiveAt: null, checkoutStatus: null, fetchReason: null };
function billingFixture(state = dashboard): BillingPort {
  return {
    plans: vi.fn().mockResolvedValue(["basic", "pro", "ultra", "mega"].map(plan => ({ plan, priceMonthly: 8, priceYearly: 80, creditsLimit: 500, active: true }))),
    dashboard: vi.fn().mockResolvedValue(state),
    createIntent: vi.fn().mockResolvedValue({ id: "intent-1", displayedAmount: 8, currency: "USD", checkoutStatus: "not_started" }),
    intent: vi.fn().mockResolvedValue({ id: "intent-1", displayedAmount: 8, currency: "USD", checkoutStatus: "pending" }),
    checkout: vi.fn().mockResolvedValue({ checkoutUrl: "https://checkout.stripe.com/pay", status: "pending" }),
    change: vi.fn().mockResolvedValue({ status: "payment_pending", invoiceUrl: "https://invoice.stripe.com/pay", effectiveAt: null }),
    portal: vi.fn().mockResolvedValue({ portalUrl: "https://billing.stripe.com/pay" }),
    subscription: vi.fn().mockResolvedValue(undefined)
  };
}

describe("PlanSelectionPage", () => {
  it("allows choosing another pack after canceling the payment dialog", async () => {
    const billing = billingFixture({ ...dashboard, plan: "mega" });
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Mega" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Add-on Packs" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select Add-on Packs" }));
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await waitFor(() => expect(billing.createIntent).toHaveBeenCalledTimes(2));
    expect(billing.createIntent).toHaveBeenLastCalledWith({ itemType: "addon", addonCredits: 600 });
  });
  it("lets the server reject a new upgrade and displays its error after canceling", async () => {
    const billing = billingFixture({ ...dashboard, plan: "pro" });
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    vi.mocked(billing.dashboard).mockResolvedValue({ ...dashboard, plan: "pro", checkoutStatus: "payment_pending" });
    vi.mocked(billing.change).mockRejectedValue(new AgentLensError("unknown", "An upgrade payment is already pending", false, 409, undefined, undefined, undefined, "PAYMENT_PENDING"));
    fireEvent.click(screen.getByRole("button", { name: "Select Mega" }));
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An upgrade payment is already pending");
    expect(screen.getByRole("alert")).toHaveClass("agentlens-parse-error");
    expect(billing.change).toHaveBeenLastCalledWith("upgrade", "mega", "monthly");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Ultra" })).toBeEnabled();
  });
  it("automatically confirms payment on return and coalesces focus and visibility events", async () => {
    const billing = billingFixture();
    const refresh = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} onAccountChanged={refresh} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
    fireEvent.focus(window);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(billing.intent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    vi.mocked(billing.intent).mockResolvedValue({ id: "intent-1", displayedAmount: 8, currency: "USD", checkoutStatus: "paid" });
    vi.mocked(billing.dashboard).mockResolvedValue({ ...dashboard, plan: "ultra" });
    fireEvent.focus(window);
    fireEvent(document, new Event("visibilitychange"));
    await screen.findByRole("dialog", { name: "Payment successful" });
    expect(billing.intent).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
    fireEvent.focus(window);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(billing.intent).toHaveBeenCalledTimes(1);
  });
  it("keeps automatic errors quiet and allows manual status checks after returning", async () => {
    const billing = billingFixture();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    const view = render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    vi.mocked(billing.intent).mockRejectedValue(new Error("Status unavailable"));
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
  it("waits for checkout and the system browser before displaying the pending dialog", async () => {
    const billing = billingFixture();
    let resolveCheckout!: (value: Awaited<ReturnType<BillingPort["checkout"]>>) => void;
    let resolveBrowser!: () => void;
    vi.mocked(billing.checkout).mockImplementation(() => new Promise(resolve => { resolveCheckout = resolve; }));
    const openExternal = vi.fn(() => new Promise<void>(resolve => { resolveBrowser = resolve; }));
    vi.stubGlobal("require", (name: string) => name === "electron" ? { shell: { openExternal } } : undefined);
    try {
      render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
      await waitFor(() => expect(billing.checkout).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "View pending payment" })).not.toBeInTheDocument();
      await act(async () => { resolveCheckout({ checkoutUrl: "https://checkout.stripe.com/pay", status: "pending" }); });
      expect(openExternal).toHaveBeenCalledWith("https://checkout.stripe.com/pay");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await act(async () => { resolveBrowser(); });
      expect(screen.getByRole("dialog", { name: "Complete your purchase in Stripe" })).toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps a failed browser launch on the page and retries the original payment link", async () => {
    const billing = billingFixture();
    const openExternal = vi.fn().mockRejectedValueOnce(new Error("Browser unavailable")).mockResolvedValue(undefined);
    vi.stubGlobal("require", (name: string) => name === "electron" ? { shell: { openExternal } } : undefined);
    try {
      render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Browser unavailable");
      expect(screen.getByRole("alert")).toHaveClass("agentlens-parse-error");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "View pending payment" }));
      fireEvent.click(screen.getByRole("button", { name: "Reopen checkout" }));
      await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));
      expect(billing.createIntent).toHaveBeenCalledTimes(1);
      expect(billing.checkout).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it("explains annual upgrade credit and prevents starting payment", async () => {
    const billing = billingFixture({ ...dashboard, plan: "pro", billingCycle: "yearly" });
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Ultra" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    expect(screen.getByText(/The credit for unused subscription time/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeDisabled();
    expect(billing.checkout).not.toHaveBeenCalled();
    expect(billing.change).not.toHaveBeenCalled();
  });
  it("confirms server prices, deduplicates checkout and refreshes only after payment is confirmed", async () => {
    const billing = billingFixture();
    const refresh = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} onAccountChanged={refresh} />);
    const card = await screen.findByRole("button", { name: "Credit Card Payment" });
    await waitFor(() => expect(card).toBeEnabled());
    expect(screen.getByText("Ultra — $8.00/month")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Ultra" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(billing.createIntent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Alipay | WeChat Pay" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh billing" })).not.toBeInTheDocument();
    fireEvent.click(card); fireEvent.click(card);
    await screen.findByRole("dialog", { name: "Complete your purchase in Stripe" });
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Credit Card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Continue to checkout?" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    expect(billing.checkout).toHaveBeenCalledWith("intent-1");
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
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await screen.findByText("Connection lost");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View pending payment" }));
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
  it("reopens the original upgrade invoice and shows success only after the matching plan and cycle apply", async () => {
    const billing = billingFixture({ ...dashboard, plan: "pro" });
    const open = vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reopen checkout" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Reopen checkout" }));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith("https://invoice.stripe.com/pay", "_blank", "noopener,noreferrer"));
    expect(billing.change).toHaveBeenCalledTimes(1);
    expect(billing.createIntent).toHaveBeenCalledTimes(1);
    expect(billing.checkout).not.toHaveBeenCalled();
    vi.mocked(billing.dashboard).mockResolvedValue({ ...dashboard, plan: "ultra", billingCycle: "yearly", checkoutStatus: "payment_pending" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByText("Waiting for payment confirmation. You can check again after completing payment.");
    expect(screen.queryByRole("dialog", { name: "Payment successful" })).not.toBeInTheDocument();
    vi.mocked(billing.dashboard).mockResolvedValue({ ...dashboard, plan: "ultra" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Check payment status" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByRole("dialog", { name: "Payment successful" });
  });
  it("keeps status errors in the yellow alert without showing payment success", async () => {
    const billing = billingFixture();
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    render(<PlanSelectionPage currentPlan="Basic" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
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
  it("upgrades existing subscriptions and schedules downgrades", async () => {
    const billing = billingFixture({ ...dashboard, plan: "pro" });
    vi.spyOn(window, "open").mockReturnValue({ opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window);
    const result = render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Ultra" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select Ultra" }));
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(billing.change).toHaveBeenCalledWith("upgrade", "ultra", "monthly"));
    expect(billing.checkout).not.toHaveBeenCalled();
    result.unmount();
    const second = billingFixture({ ...dashboard, plan: "mega" });
    render(<PlanSelectionPage currentPlan="Mega" onBack={vi.fn()} billing={second} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Ultra" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select Ultra" }));
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await waitFor(() => expect(second.change).toHaveBeenCalledWith("schedule-change", "ultra", "monthly"));
    expect(second.checkout).not.toHaveBeenCalled();
  });
  it("keeps the selection, cycle and add-on summary synchronized", () => {
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} />);
    expect(screen.getByText("Current").closest("button")).toHaveAccessibleName("Select Pro");
    expect(screen.getByText("Ultra — $6.90/month")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Pro" }));
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    expect(screen.getByText("Pro — $29.90/year")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Choose a pack" }), { target: { value: "600" } });
    expect(screen.getByText("Add-on Packs (600 credits) — $6.90 one-off")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Add-on Packs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Credit Card" })).not.toBeInTheDocument();
  });
  it("closes the scheduled-change dialog and displays the effective plan without starting payment", async () => {
    const billing = billingFixture({ ...dashboard, plan: "mega" });
    const open = vi.spyOn(window, "open");
    render(<PlanSelectionPage currentPlan="Mega" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
    vi.mocked(billing.change).mockResolvedValue({ status: "change_scheduled", invoiceUrl: null, effectiveAt: "2026-11-01" });
    vi.mocked(billing.dashboard).mockResolvedValue({ ...dashboard, plan: "mega", scheduledPlan: "ultra", scheduledBillingCycle: "monthly", scheduledEffectiveAt: "2026-11-01" });
    vi.mocked(billing.dashboard).mockResolvedValueOnce({ ...dashboard, plan: "mega" });
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await screen.findByRole("button", { name: "Keep Mega" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(billing.checkout).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep Mega" }));
    await waitFor(() => expect(billing.subscription).toHaveBeenCalledWith("cancel-scheduled-change"));
  });
  it("cancels renewal for Basic and resumes it without a checkout order", async () => {
    const billing = billingFixture({ ...dashboard, plan: "pro" });
    render(<PlanSelectionPage currentPlan="Pro" onBack={vi.fn()} billing={billing} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Credit Card Payment" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select Basic" }));
    fireEvent.click(screen.getByRole("button", { name: "Credit Card Payment" }));
    await screen.findByRole("dialog", { name: "Cancel renewal?" });
    vi.mocked(billing.dashboard).mockResolvedValue({ ...dashboard, plan: "pro", cancelAtPeriodEnd: true });
    fireEvent.click(screen.getByRole("button", { name: "Cancel renewal" }));
    await screen.findByRole("button", { name: "Keep Pro" });
    expect(billing.subscription).toHaveBeenCalledWith("cancel-at-period-end");
    expect(billing.createIntent).not.toHaveBeenCalled();
    expect(billing.change).not.toHaveBeenCalled();
    expect(billing.checkout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep Pro" }));
    await waitFor(() => expect(billing.subscription).toHaveBeenCalledWith("resume"));
  });
});
