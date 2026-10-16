import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EmailAuthPage } from "../src/ui/workbench/EmailAuthPage";

it("clears the previous reset success when the next attempt has an empty email", async () => {
 const reset = vi.fn().mockResolvedValue("ok");
 render(<EmailAuthPage mode="login" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={vi.fn()} onBrowserSignIn={vi.fn()} onPasswordReset={reset} />);
 const email = screen.getByLabelText(/Email/);
 fireEvent.change(email,{target:{value:"test@example.com"}});
 fireEvent.click(screen.getByRole("button",{name:"Forgot your password?"}));
 expect(await screen.findByRole("status")).toHaveTextContent("receive a reset link");
 fireEvent.change(email,{target:{value:""}});
 fireEvent.click(screen.getByRole("button",{name:"Forgot your password?"}));
 expect(screen.getByRole("alert")).toHaveTextContent("Enter your email address first.");
 expect(screen.queryByRole("status")).toBeNull();
 expect(reset).toHaveBeenCalledTimes(1);
});
