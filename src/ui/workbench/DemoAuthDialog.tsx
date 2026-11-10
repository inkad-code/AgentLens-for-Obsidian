import { useState, type ComponentProps } from "react";
import { EmailAuthPage } from "./EmailAuthPage";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { authAssets } from "./authAssets";
import success from "./assets/demo-auth/success.svg";

type AuthProps = ComponentProps<typeof EmailAuthPage>;

/** Post-save authentication leaves the completed demo and its results intact. */
export function DemoAuthDialog({ onClose, onSubmit, onBrowserSignIn, onPasswordReset, busy, browserPending, browserOpening, browserError, onCancelBrowserSignIn }: {
  onClose: () => void;
  onCancelBrowserSignIn?: () => void;
  onSubmit: AuthProps["onSubmit"];
  onBrowserSignIn: () => void;
  onPasswordReset: AuthProps["onPasswordReset"];
  busy: boolean;
  browserPending: boolean;
  browserOpening: boolean;
  browserError: string | null;
}) {
  const [step, setStep] = useState<"choose" | "login" | "register">("choose");
  const [resetOpen,setResetOpen] = useState(false);
  function changeStep(next: typeof step) {
    if (browserPending) onCancelBrowserSignIn?.();
    setStep(next);
  }
  const registration = step !== "login";
  return <WorkbenchDialog compact textClose title={resetOpen ? "Reset your password" : "Successfully saved to Obsidian!"} className={`agentlens-demo-auth-dialog is-${step}${resetOpen ? " is-password-reset" : ""}${step === "choose" && (browserPending || browserError) ? " has-feedback" : ""}`} onClose={onClose}>
    {!resetOpen && <><div className="agentlens-demo-auth-status"><img src={success} width="16" height="16" alt="" />Successfully saved to Obsidian!</div>
    <p className="agentlens-demo-auth-switch">{registration ? "Already have an account? " : "Don't have an account? "}<button type="button" disabled={busy} onClick={() => changeStep(registration ? "login" : "register")}>{registration ? "Sign In" : "Sign Up"}</button></p></>}
    {step === "choose" ? <div className="agentlens-demo-auth-choice">
      <h3>Sign up to unlock monthly perks</h3>
      <div className="agentlens-demo-auth-benefits" aria-label="Account benefits">
        <div><i className="agentlens-auth-credits-icon"><img src={authAssets.benefitCreditsBase} alt="" /><img className="agentlens-auth-credits-monthly" src={authAssets.benefitCreditsMonthly} alt="" /></i><span>20 Free Credits<br />Monthly</span></div>
        <div><i><img src={authAssets.benefitSocialEagle} alt="" /></i><span>From Social<br />Media to Obsidian</span></div>
        <div><i><img src={authAssets.benefitAutoTag} alt="" /></i><span>Rename &amp;<br />Auto-Tag</span></div>
      </div>
      <div className="agentlens-demo-auth-options">
        <button type="button" className="mod-cta" disabled={browserPending ? browserOpening : busy} onClick={onBrowserSignIn}><img src={authAssets.imgFrame} width="18" height="18" alt="" />{browserPending ? "Open Google sign-in again" : browserError ? "Try Google sign-in again" : "Sign Up with Google"}</button>
        <div className="agentlens-auth-divider"><span>or</span></div>
        <button type="button" disabled={busy} onClick={() => changeStep("register")}>Continue with Email</button>
        {browserPending && <p role="status">Finish Google sign-in in your browser, then return to Obsidian.</p>}
        {browserError && <p className="agentlens-inline-error" role="alert">{browserError}</p>}
      </div>
      <small>* 1 successful parse = 1 credit (up to 20 free credits/month)</small>
    </div> : <EmailAuthPage compact onResetViewChange={setResetOpen} onResetClose={onClose} key={step} mode={step} busy={busy} browserPending={browserPending} browserOpening={browserOpening} browserError={browserError} onBack={() => changeStep("choose")} onModeChange={changeStep} onSubmit={onSubmit} onBrowserSignIn={onBrowserSignIn} onPasswordReset={onPasswordReset} />}
  </WorkbenchDialog>;
}
