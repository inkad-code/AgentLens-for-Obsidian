import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DemoAuthDialog } from "../src/ui/workbench/DemoAuthDialog";

function setup(overrides = {}) {
  const props = { onClose: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined), onBrowserSignIn: vi.fn(), onPasswordReset: vi.fn().mockResolvedValue("Sent"), busy: false, browserPending: false, browserOpening: false, browserError: null, ...overrides };
  render(<DemoAuthDialog {...props} />);
  return props;
}

it("offers Google or email after saving and closes without starting authentication", () => {
  const props = setup();
  expect(screen.getByRole("dialog", { name: "Successfully saved to Obsidian!" })).toBeVisible();
  expect(screen.getByText(/Media to Obsidian/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Sign Up with Google" }));
  expect(props.onBrowserSignIn).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(props.onSubmit).not.toHaveBeenCalled();
});

it("validates email sign-in inline and submits the existing credentials contract", async () => {
  const props = setup();
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter your email address first.");
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "reader@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Test20@6" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ email: "reader@example.com", password: "Test20@6" }));
  await waitFor(() => expect(screen.getByLabelText(/^Password/)).toHaveValue(""));
});

it("registers without a nickname and retains shared password visibility and terms validation", async () => {
  const props = setup();
  expect(screen.getByRole("button", { name: "Sign In" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Continue with Email" }));
  expect(screen.getByLabelText("Nick Name")).not.toBeRequired();
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "reader@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Test20@6" } });
  fireEvent.change(screen.getByLabelText(/^Confirm password/), { target: { value: "Test20@6" } });
  fireEvent.click(screen.getByRole("button", { name: "Show confirm password" }));
  expect(screen.getByLabelText(/^Password/)).toHaveAttribute("type", "text");
  expect(screen.getByLabelText(/^Confirm password/)).toHaveAttribute("type", "text");
  const continueButton = screen.getByRole("button", { name: "Continue" });
  expect(continueButton).toBeDisabled();
  fireEvent.click(continueButton);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(props.onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(continueButton).toBeEnabled();
  fireEvent.click(continueButton);
  await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ email: "reader@example.com", password: "Test20@6", name: "" }));
});

it("resets passwords inside the dialog and shows server failures inline", async () => {
  const props = setup({ onPasswordReset: vi.fn().mockRejectedValue(new Error("Service unavailable")) });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "reader@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Forgot your password?" }));
  expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await waitFor(() => expect(props.onPasswordReset).toHaveBeenCalledWith("reader@example.com"));
  expect(await screen.findByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText(/^Password/)).toBeVisible();
});

it("shows email authentication errors without leaving the completion dialog", async () => {
  setup({ onSubmit: vi.fn().mockRejectedValue(new Error("Invalid credentials")) });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "reader@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Test20@6" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByLabelText(/^Email/)).toHaveValue("reader@example.com");
  expect(screen.getByLabelText(/^Password/)).toHaveValue("");
});

it("offers reopening Google authorization while it is pending", () => {
  const props = setup({ browserPending: true });
  expect(screen.getByRole("status")).toHaveTextContent("return to Obsidian");
  fireEvent.click(screen.getByRole("button", { name: "Open Google sign-in again" }));
  expect(props.onBrowserSignIn).toHaveBeenCalledTimes(1);
});

it.each(["Continue with Email", "Sign In"])("cancels pending Google authorization when choosing %s", label => {
  const cancel = vi.fn();
  setup({ browserPending: true, onCancelBrowserSignIn: cancel });
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(screen.getByLabelText(/^Email/)).toBeEnabled();
});
