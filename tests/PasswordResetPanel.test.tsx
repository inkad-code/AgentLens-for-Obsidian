import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { PasswordResetPanel } from "../src/ui/workbench/PasswordResetPanel";

function setup(initialEmail = "", request = vi.fn().mockResolvedValue("Sent")) {
  const onBack = vi.fn(), onClose = vi.fn();
  function Fixture() {
    const [email, setEmail] = useState(initialEmail);
    return <PasswordResetPanel email={email} onEmailChange={setEmail} onBack={onBack} onClose={onClose} onPasswordReset={request} busy={false} />;
  }
  const view = render(<Fixture />);
  return { ...view, onBack, onClose, request };
}

it("validates missing and malformed emails inline before sending", () => {
  const { request } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter your email address first.");
  const input = screen.getByLabelText(/^Email/);
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
  expect(request).not.toHaveBeenCalled();
});

it("shows the dedicated success state and returns to the email without resending", async () => {
  const { request, onClose } = setup("reader@example.com");
  expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Password reset email sent!Check your inbox and follow the link.");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText(/^Email/)).toHaveValue("reader@example.com");
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  fireEvent.click(await screen.findByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("prevents duplicate sends while the request is pending", async () => {
  let resolve!: (value: string) => void;
  const request = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  setup("reader@example.com", request);
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(/^Email/)).toBeDisabled();
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  resolve("Sent");
  expect(await screen.findByRole("status")).toBeVisible();
});

it("keeps failed requests in the email state and allows retry", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("Service unavailable")).mockResolvedValue("Sent");
  setup("reader@example.com", request);
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/^Email/)).toHaveValue("reader@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("status")).toBeVisible();
});

it("supports both Back controls without sending a request", () => {
  const { request, onBack } = setup("reader@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Back to previous step" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalledTimes(2);
  expect(request).not.toHaveBeenCalled();
});
