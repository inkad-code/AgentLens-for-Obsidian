import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EmailAuthPage } from "../src/ui/workbench/EmailAuthPage";

it("allows returning while waiting for Google but prevents Back during an email submission", () => {
 const onBack=vi.fn();
 const props={mode:"login" as const,busy:true,browserPending:true,browserOpening:false,onBack,onModeChange:vi.fn(),onSubmit:vi.fn(),onBrowserSignIn:vi.fn(),onPasswordReset:vi.fn()};
 const view=render(<EmailAuthPage {...props} />);
 const back=screen.getByRole("button",{name:"Back"});
 expect(back).toBeEnabled();
 fireEvent.click(back);expect(onBack).toHaveBeenCalledTimes(1);
 view.rerender(<EmailAuthPage {...props} browserPending={false} />);
 expect(back).toBeDisabled();
 fireEvent.click(back);expect(onBack).toHaveBeenCalledTimes(1);
});

it("toggles both registration passwords together from either control without changing credentials or submitting", () => {
 const submit = vi.fn();
 render(<EmailAuthPage mode="register" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={submit} onBrowserSignIn={vi.fn()} onPasswordReset={vi.fn()} />);
 const password = screen.getByLabelText(/^Password/);
 const confirm = screen.getByLabelText(/Confirm password/);
 fireEvent.change(password,{target:{value:"example1!"}});
 fireEvent.change(confirm,{target:{value:"example1!"}});
 expect(password).toHaveAttribute("type","password");
 expect(confirm).toHaveAttribute("type","password");
 fireEvent.click(screen.getByRole("button",{name:"Show confirm password"}));
 expect(confirm).toHaveAttribute("type","text");
 expect(password).toHaveAttribute("type","text");
 expect(screen.getByRole("button",{name:"Hide password"})).toHaveAttribute("aria-pressed","true");
 expect(screen.getByRole("button",{name:"Hide confirm password"})).toHaveAttribute("aria-pressed","true");
 fireEvent.click(screen.getByRole("button",{name:"Hide password"}));
 expect(password).toHaveAttribute("type","password");
 expect(confirm).toHaveAttribute("type","password");
 expect(screen.getByRole("button",{name:"Show password"})).toHaveAttribute("aria-pressed","false");
 expect(screen.getByRole("button",{name:"Show confirm password"})).toHaveAttribute("aria-pressed","false");
 fireEvent.click(screen.getByRole("button",{name:"Show password"}));
 expect(password).toHaveAttribute("type","text");
 expect(confirm).toHaveAttribute("type","text");
 fireEvent.click(screen.getByRole("button",{name:"Hide confirm password"}));
 expect(confirm).toHaveAttribute("type","password");
 expect(password).toHaveAttribute("type","password");
 expect(password).toHaveValue("example1!");
 expect(confirm).toHaveValue("example1!");
 expect(submit).not.toHaveBeenCalled();
});

it("shows inline agreement feedback without a native validation bubble and preserves registration fields", async () => {
 const submit = vi.fn().mockResolvedValue(undefined);
 render(<EmailAuthPage mode="register" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={submit} onBrowserSignIn={vi.fn()} onPasswordReset={vi.fn()} />);
 fireEvent.change(screen.getByLabelText("Nick Name"),{target:{value:"  Test User  "}});
 fireEvent.change(screen.getByLabelText(/Email/),{target:{value:"user@example.com"}});
 const password = screen.getByLabelText(/^Password/);
 const confirm = screen.getByLabelText(/Confirm password/);
 fireEvent.change(password,{target:{value:"example1!"}});
 fireEvent.change(confirm,{target:{value:"example1!"}});
 const terms = screen.getByRole("checkbox");
 expect(terms.closest("form")).toHaveProperty("noValidate",true);
 const create = screen.getByRole("button",{name:"Create account"});
 expect(create).toBeDisabled();
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 fireEvent.submit(terms.closest("form")!);
 const feedback = screen.getByRole("alert");
 expect(feedback).toHaveTextContent("Please agree to the Terms of Service and Privacy Policy.");
 expect(terms).toBeRequired();
 expect(terms).toHaveAttribute("aria-invalid","true");
 expect(terms).toHaveAttribute("aria-describedby",feedback.id);
 expect(submit).not.toHaveBeenCalled();
 expect(password).toHaveValue("example1!");
 expect(confirm).toHaveValue("example1!");
 fireEvent.click(terms);
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(terms).not.toHaveAttribute("aria-invalid");
 expect(terms).not.toHaveAttribute("aria-describedby");
 expect(create).toBeEnabled();
 fireEvent.click(create);
 await waitFor(()=>expect(submit).toHaveBeenCalledWith({name:"Test User",email:"user@example.com",password:"example1!"}));
});

it("requires agreement when a registration submit is dispatched directly", () => {
 const submit = vi.fn();
 render(<EmailAuthPage mode="register" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={submit} onBrowserSignIn={vi.fn()} onPasswordReset={vi.fn()} />);
 fireEvent.change(screen.getByLabelText("Nick Name"),{target:{value:"Test User"}});
 const email = screen.getByLabelText(/Email/);
 fireEvent.change(email,{target:{value:"user@example.com"}});
 fireEvent.change(screen.getByLabelText(/^Password/),{target:{value:"example1!"}});
 fireEvent.change(screen.getByLabelText(/Confirm password/),{target:{value:"example1!"}});
 fireEvent.submit(email.closest("form")!);
 expect(screen.getByRole("alert")).toHaveTextContent("Please agree to the Terms of Service and Privacy Policy.");
 expect(submit).not.toHaveBeenCalled();
});

it("validates required fields in order and accepts a whitespace-only nickname", async () => {
 const submit = vi.fn().mockResolvedValue(undefined);
 render(<EmailAuthPage mode="register" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={submit} onBrowserSignIn={vi.fn()} onPasswordReset={vi.fn()} />);
 const button = screen.getByRole("button",{name:"Create account"});
 const nickname = screen.getByLabelText("Nick Name");
 const email = screen.getByLabelText(/Email/);
 const password = screen.getByLabelText(/^Password/);
 const confirm = screen.getByLabelText(/Confirm password/);
 const terms = screen.getByRole("checkbox");
 expect(nickname).not.toBeRequired();
 fireEvent.change(nickname,{target:{value:"   "}});
 fireEvent.click(terms);
 fireEvent.click(button);
 expect(screen.getByRole("alert")).toHaveTextContent("Enter your email address first.");
 expect(terms).not.toHaveAttribute("aria-invalid");
 fireEvent.change(email,{target:{value:"invalid-email"}});
 fireEvent.click(button);
 expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
 expect(email).toHaveAttribute("aria-invalid","true");
 fireEvent.change(email,{target:{value:"user@example.com"}});
 fireEvent.click(button);
 expect(screen.getByRole("alert")).toHaveTextContent("Enter your password.");
 fireEvent.change(password,{target:{value:"example1!"}});
 fireEvent.click(button);
 expect(screen.getByRole("alert")).toHaveTextContent("Confirm your password.");
 fireEvent.change(confirm,{target:{value:"example1!"}});
 expect(submit).not.toHaveBeenCalled();
 fireEvent.click(button);
 await waitFor(()=>expect(submit).toHaveBeenCalledWith({name:"",email:"user@example.com",password:"example1!"}));
});

it("validates login fields inline without applying registration password rules", async () => {
 const submit = vi.fn().mockResolvedValue(undefined);
 render(<EmailAuthPage mode="login" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={submit} onBrowserSignIn={vi.fn()} onPasswordReset={vi.fn()} />);
 const button = screen.getByRole("button",{name:"Continue"});
 const email = screen.getByLabelText(/Email/);
 const password = screen.getByLabelText(/^Password/);
 const terms=screen.getByRole("checkbox");
 expect(button).toBeDisabled();
 fireEvent.click(terms);
 fireEvent.click(button);
 expect(screen.getByRole("alert")).toHaveTextContent("Enter your email address first.");
 fireEvent.change(email,{target:{value:"invalid-email"}});
 fireEvent.click(button);
 expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
 fireEvent.change(email,{target:{value:"user@example.com"}});
 fireEvent.click(button);
 expect(screen.getByRole("alert")).toHaveTextContent("Enter your password.");
 expect(submit).not.toHaveBeenCalled();
 fireEvent.change(password,{target:{value:"old"}});
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 fireEvent.click(terms);
 expect(button).toBeDisabled();
 fireEvent.click(button);
 expect(submit).not.toHaveBeenCalled();
 expect(terms).not.toBeChecked();expect(terms).toBeRequired();
 fireEvent.click(terms);expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 fireEvent.click(button);
 await waitFor(()=>expect(submit).toHaveBeenCalledWith({email:"user@example.com",password:"old"}));
});

it("clears the previous reset success when the next attempt has an empty email", async () => {
 const reset = vi.fn().mockResolvedValue("ok");
 render(<EmailAuthPage mode="login" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={vi.fn()} onBrowserSignIn={vi.fn()} onPasswordReset={reset} />);
 fireEvent.change(screen.getByLabelText(/Email/),{target:{value:"test@example.com"}});
 fireEvent.click(screen.getByRole("button",{name:"Forgot your password?"}));
 const recovery=within(screen.getByRole("dialog",{name:"Reset your password"}));
 fireEvent.click(recovery.getByRole("button",{name:"Send reset link"}));
 expect(await recovery.findByRole("status")).toHaveTextContent("Password reset email sent!");
 fireEvent.click(recovery.getByRole("button",{name:"Back"}));
 fireEvent.change(recovery.getByRole("textbox",{name:/Email/}),{target:{value:""}});
 fireEvent.click(recovery.getByRole("button",{name:"Send reset link"}));
 expect(recovery.getByRole("alert")).toHaveTextContent("Enter your email address first.");
 expect(recovery.queryByRole("status")).toBeNull();
 expect(reset).toHaveBeenCalledTimes(1);
});

it("opens an email-only reset dialog and returns to login without retaining a password", async () => {
 const reset = vi.fn().mockResolvedValue("ok"), submit = vi.fn();
 render(<EmailAuthPage mode="login" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={submit} onBrowserSignIn={vi.fn()} onPasswordReset={reset} />);
 fireEvent.change(screen.getByLabelText(/Email/),{target:{value:"user@example.com"}});
 fireEvent.change(screen.getByLabelText(/^Password/),{target:{value:"private-password"}});
 fireEvent.click(screen.getByRole("button",{name:"Show password"}));
 fireEvent.click(screen.getByRole("button",{name:"Forgot your password?"}));
 const recovery=within(screen.getByRole("dialog",{name:"Reset your password"}));
 expect(recovery.getByRole("region",{name:"Reset your password"})).toBeVisible();
 expect(recovery.queryByLabelText(/^Password/)).not.toBeInTheDocument();
 expect(recovery.queryByRole("button",{name:"Sign in with Google"})).not.toBeInTheDocument();
 expect(recovery.getAllByRole("textbox")).toHaveLength(1);
 expect(reset).not.toHaveBeenCalled();
 fireEvent.click(recovery.getByRole("button",{name:"Send reset link"}));
 await recovery.findByRole("status");
 expect(reset).toHaveBeenCalledWith("user@example.com");expect(submit).not.toHaveBeenCalled();
 fireEvent.click(recovery.getByRole("button",{name:"Close"}));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 expect(screen.getByLabelText(/Email/)).toHaveValue("user@example.com");
 expect(screen.getByLabelText(/^Password/)).toHaveValue("");
 expect(screen.getByLabelText(/^Password/)).toHaveAttribute("type","password");
});

it("validates the reset email and allows retrying a failed reset request", async () => {
 const reset=vi.fn().mockRejectedValueOnce(new Error("Connection failed")).mockResolvedValue("ok");
 render(<EmailAuthPage mode="login" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={vi.fn()} onBrowserSignIn={vi.fn()} onPasswordReset={reset} />);
 fireEvent.click(screen.getByRole("button",{name:"Forgot your password?"}));
 const recovery=within(screen.getByRole("dialog",{name:"Reset your password"}));
 fireEvent.change(recovery.getByRole("textbox",{name:/Email/}),{target:{value:"not-an-email"}});
 fireEvent.click(recovery.getByRole("button",{name:"Send reset link"}));
 expect(recovery.getByRole("alert")).toHaveTextContent("Enter a valid email address.");expect(reset).not.toHaveBeenCalled();
 fireEvent.change(recovery.getByRole("textbox",{name:/Email/}),{target:{value:"user@example.com"}});
 fireEvent.click(recovery.getByRole("button",{name:"Send reset link"}));
 await waitFor(()=>expect(reset).toHaveBeenCalledTimes(1));await recovery.findByRole("alert");
 await waitFor(()=>expect(recovery.getByRole("button",{name:"Send reset link"})).toBeEnabled());
 fireEvent.click(recovery.getByRole("button",{name:"Send reset link"}));
 expect(await recovery.findByRole("status")).toHaveTextContent("Password reset email sent!");
 expect(recovery.queryByRole("alert")).not.toBeInTheDocument();expect(reset).toHaveBeenCalledTimes(2);
});

it("blocks duplicate reset submissions while the request is pending", async () => {
 let complete!: (message:string)=>void;
 const reset=vi.fn(()=>new Promise<string>(resolve=>{complete=resolve;}));
 render(<EmailAuthPage mode="login" busy={false} browserPending={false} browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={vi.fn()} onBrowserSignIn={vi.fn()} onPasswordReset={reset} />);
 fireEvent.click(screen.getByRole("button",{name:"Forgot your password?"}));
 const recovery=within(screen.getByRole("dialog",{name:"Reset your password"}));
 const email=recovery.getByRole("textbox",{name:/Email/});fireEvent.change(email,{target:{value:"user@example.com"}});
 const form=email.closest("form")!;fireEvent.submit(form);fireEvent.submit(form);
 expect(reset).toHaveBeenCalledTimes(1);expect(email).toBeDisabled();
 expect(recovery.getByRole("button",{name:"Sending…"})).toBeDisabled();
 expect(recovery.getByRole("button",{name:"Back"})).toBeDisabled();
 expect(recovery.getByRole("button",{name:"Back to previous step"})).toBeDisabled();
 await act(async()=>{complete("ok");});
 expect(recovery.getByRole("status")).toHaveTextContent("Password reset email sent!");
 expect(recovery.queryByRole("button",{name:"Send reset link"})).not.toBeInTheDocument();
 expect(recovery.getByRole("button",{name:"Close"})).toBeEnabled();
});


it.each(["login","register"] as const)("requires agreement before starting Google %s without requiring email fields",mode=>{
 const google=vi.fn();
 const view=render(<EmailAuthPage mode={mode} busy={false} browserPending={false} browserOpening={false} onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={vi.fn()} onBrowserSignIn={google} onPasswordReset={vi.fn()} />);
 const button=screen.getByRole("button",{name:mode==="login"?"Sign in with Google":"Sign up with Google"});
 const terms=screen.getByRole("checkbox");
 fireEvent.click(button);
 expect(google).not.toHaveBeenCalled();expect(terms).toHaveFocus();expect(terms).toHaveAttribute("aria-invalid","true");
 expect(screen.getByRole("alert")).toHaveTextContent("Please agree to the Terms of Service and Privacy Policy.");
 fireEvent.click(terms);fireEvent.click(button);
 expect(google).toHaveBeenCalledTimes(1);expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 view.rerender(<EmailAuthPage mode={mode} busy browserPending browserOpening={false} onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={vi.fn()} onBrowserSignIn={google} onPasswordReset={vi.fn()} />);
 fireEvent.click(screen.getByRole("button",{name:"Open Google sign-in again"}));expect(google).toHaveBeenCalledTimes(2);
});

it("cancels Google authorization when the user returns to the email form", () => {
 const cancel = vi.fn();
 render(<EmailAuthPage mode="login" busy={false} browserPending browserOpening={false}
  onBack={vi.fn()} onModeChange={vi.fn()} onSubmit={vi.fn()} onBrowserSignIn={vi.fn()} onPasswordReset={vi.fn()} onCancelBrowserSignIn={cancel} />);
 const email = screen.getByLabelText(/Email/);
 expect(email).toBeEnabled();
 fireEvent.focus(email);
 expect(cancel).toHaveBeenCalledOnce();
});
