import { PasswordResetPanel } from "./PasswordResetPanel";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { useState, useId, useRef, useLayoutEffect, type SyntheticEvent } from "react";
import type { EmailCredentials } from "../../auth/AuthService";
import { validRegistrationPassword } from "../../auth/PasswordPolicy";
import { authAssets } from "./authAssets";
import { message } from "./shared";

type AuthField = "email" | "password" | "confirm" | "terms";

export function EmailAuthPage({mode,busy,browserPending,browserOpening,browserError,onBack,onModeChange,onSubmit,onBrowserSignIn,onPasswordReset,compact=false,onResetViewChange,onResetClose,onCancelBrowserSignIn}: {
 compact?: boolean;
 onResetViewChange?: (open:boolean)=>void;
 onResetClose?: ()=>void;
 onCancelBrowserSignIn?: ()=>void;
 mode: "login" | "register";
 busy: boolean;
 browserPending: boolean;
 browserOpening: boolean;
 browserError?: string | null;
 onBack: ()=>void;
 onModeChange: (mode:"login"|"register")=>void;
 onSubmit: (credentials:EmailCredentials)=>Promise<void>;
 onBrowserSignIn: ()=>void;
 onPasswordReset: (email:string)=>Promise<string>;
}) {
 const passwordId=useId();
 const confirmId=useId();
 const feedbackId=useId();
 const [invalidField,setInvalidField]=useState<AuthField|null>(null);
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [nickname,setNickname]=useState("");
 const [confirm,setConfirm]=useState("");
 const [agreed,setAgreed]=useState(false);
 const [visible,setVisible]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [resetView,setResetView]=useState(false);
 const emailInput=useRef<HTMLInputElement>(null);
 const agreementInput=useRef<HTMLInputElement>(null);
 const registration=mode==='register';
 const requiresAgreement=registration || !compact;
 const agreementMissing=requiresAgreement && !agreed;
 function changeResetView(next:boolean) {
  setResetView(next);setError(null);setInvalidField(null);
  setPassword("");setConfirm("");setVisible(false);
 }
 function validationError(field:AuthField,text:string) {
  setError(text);setInvalidField(field);
 }
 function clearValidationError(field:AuthField) {
  if(invalidField===field){setInvalidField(null);setError(null);}
 }
 function validateAgreement() {
  if(agreementMissing) {
   validationError("terms","Please agree to the Terms of Service and Privacy Policy.");
   agreementInput.current?.focus();
   return false;
  }
  return true;
 }
 function validateEmail() {
  if(!email.trim()){validationError("email","Enter your email address first.");return false;}
  if(!emailInput.current?.validity.valid){validationError("email","Enter a valid email address.");return false;}
  return true;
 }
 async function submit(event:SyntheticEvent) {
  event.preventDefault();if(busy)return;setError(null);setInvalidField(null);
  if(!validateEmail())return;
  if(!password){validationError("password","Enter your password.");return;}
  if(registration && !confirm){validationError("confirm","Confirm your password.");return;}
  if(registration && password!==confirm){setError("Passwords do not match.");setInvalidField("confirm");return;}
  if(registration && !validRegistrationPassword(password)){setError("The password must be at least 8 characters and include a letter, a number, and a special character.");setInvalidField("password");return;}
  if(!validateAgreement())return;
  try {await onSubmit({email:email.trim(),password,...(registration?{name:nickname.trim()}: {})});}
  catch(caught){setError(message(caught,"auth"));}
  finally {setPassword("");setConfirm("");}
 }
 useLayoutEffect(()=>{onResetViewChange?.(resetView);},[resetView,onResetViewChange]);
 const resetPanel = resetView ? <PasswordResetPanel email={email} onEmailChange={setEmail} busy={busy} onPasswordReset={onPasswordReset} onBack={()=>changeResetView(false)} onClose={()=>{changeResetView(false);onResetClose?.();}} /> : null;
 const fields = <>
    {registration && <label>Nick Name<input autoComplete="nickname" value={nickname} onChange={event=>setNickname(event.currentTarget.value)} placeholder="e.g. John Doe" disabled={busy} /></label>}
    <label>Email <em>*</em><input ref={emailInput} type="email" autoComplete="email" placeholder="Enter your email address" aria-invalid={invalidField === "email" || undefined} aria-describedby={invalidField === "email" ? feedbackId : undefined} value={email} onChange={event=>{setEmail(event.currentTarget.value);clearValidationError("email");}} required disabled={busy} /></label>
    {<div className="agentlens-password-label"><label htmlFor={passwordId}>Password <em>*</em></label>{!registration && <button type="button" onClick={()=>changeResetView(true)} disabled={busy}>Forgot your password?</button>}
     <div className="agentlens-password-input"><input id={passwordId} aria-invalid={invalidField === "password" || undefined} aria-describedby={registration ? `${passwordId}-hint${invalidField === "password" ? ` ${feedbackId}` : ""}` : invalidField === "password" ? feedbackId : undefined} type={visible?'text':'password'} autoComplete={registration?'new-password':'current-password'} placeholder={registration ? "Create a password" : "Enter your password"} value={password} onChange={event=>{setPassword(event.currentTarget.value);clearValidationError("password");}} required minLength={registration?8:undefined} disabled={busy} /><button type="button" aria-label={visible?'Hide password':'Show password'} aria-pressed={visible} disabled={busy} onClick={()=>setVisible(!visible)}><img src={visible ? authAssets.imgEyeClosed : authAssets.imgEye} alt="" /></button></div>
    </div>}
    {registration && <>
     <small id={`${passwordId}-hint`}>Minimum 8 characters with letters, numbers, and special characters</small>
     <div className="agentlens-password-label">
      <label htmlFor={confirmId}>Confirm password <em>*</em></label>
      <div className="agentlens-password-input">
       <input id={confirmId} aria-invalid={invalidField === "confirm" || undefined} aria-describedby={invalidField === "confirm" ? feedbackId : undefined} type={visible?'text':'password'} autoComplete="new-password" placeholder="Re-enter your password" value={confirm} onChange={event=>{setConfirm(event.currentTarget.value);clearValidationError("confirm");}} required disabled={busy} />
       <button type="button" aria-label={visible?'Hide confirm password':'Show confirm password'} aria-pressed={visible} disabled={busy} onClick={()=>setVisible(!visible)}><img src={visible ? authAssets.imgEyeClosed : authAssets.imgEye} alt="" /></button>
      </div>
     </div>
    </>}
    {requiresAgreement && <label className="agentlens-auth-terms"><input ref={agreementInput} type="checkbox" aria-invalid={invalidField === "terms" || undefined} aria-describedby={invalidField === "terms" ? feedbackId : undefined} style={{backgroundImage:agreed ? `url(${JSON.stringify(authAssets.imgCheck)})` : undefined}} checked={agreed} onChange={event=>{setAgreed(event.currentTarget.checked);clearValidationError("terms");}} required disabled={busy} /><span>I agree to the <a href="https://agentlensapi.io/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="https://agentlensapi.io/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></span></label>}
    {browserPending && <p role="status">Finish Google sign-in in your browser, then return to Obsidian. Sign-in will finish automatically.</p>}
    {(error || browserError) && <p id={feedbackId} className="agentlens-inline-error" role="alert">{error || browserError}</p>}
 </>;
 let submitLabel = registration && !compact ? "Create account" : "Continue";
 if (browserPending) submitLabel = "Waiting for Google…";
 else if (busy) submitLabel = registration ? (compact ? "Signing Up…" : "Creating account…") : "Signing in…";
 const submitAction = <button type="submit" className="mod-cta" disabled={busy || agreementMissing} aria-busy={busy || browserPending}>{submitLabel}</button>;
 if(compact && resetPanel)return resetPanel;
 return <><main className={`agentlens-auth-page ${registration ? "is-register" : "is-login"}${compact ? " is-demo-auth" : ""}${busy || browserPending ? " is-authorizing" : ""}`}>
  {!compact && <section className="agentlens-auth-hero">
   <button type="button" className="agentlens-auth-back" disabled={busy && !browserPending} onClick={()=>{if(resetView)changeResetView(false);else onBack();}}><img src={authAssets.imgIconBack} alt="" />Back</button>
   <div className="agentlens-auth-hero-content">
    <h2>{registration ? "Sign up to unlock monthly perks" : "Sign In to unlock monthly perks"}</h2>
    <div className="agentlens-auth-benefits-band">
     <div className="agentlens-auth-benefits" aria-label="Account benefits">
      <div><i><img src={authAssets.benefitSocialEagle} alt="" /></i><strong>From Social Media<br />to Obsidian vault</strong></div>
      <div><i><span className="agentlens-auth-credits-icon"><img className="agentlens-auth-credits-base" src={authAssets.benefitCreditsBase} alt="" /><img className="agentlens-auth-credits-monthly" src={authAssets.benefitCreditsMonthly} alt="" /></span></i><strong>20 Free Credits<br />Monthly</strong></div>
      <div><i><img src={authAssets.benefitAutoTag} alt="" /></i><strong>Rename &amp;<br />Auto-Tag</strong></div>
     </div>
    </div>
    <small>* 1 successful parse = 1 credit</small>
   </div>
  </section>}
  <section className="agentlens-auth-form" aria-label={registration?'Create your account':'Sign in to your account'}>
   {!compact && <>
    <button type="button" className="agentlens-google-auth" onClick={()=>{setError(null);setInvalidField(null);if(!browserPending && !validateAgreement())return;onBrowserSignIn();}} disabled={browserPending ? browserOpening : busy}><img src={authAssets.imgFrame} alt="" />{browserPending?'Open Google sign-in again':browserError?'Try Google sign-in again':registration?'Sign up with Google':'Sign in with Google'}</button>
    <div className="agentlens-auth-divider"><span>or</span></div>
   </>}
   <form onFocusCapture={()=>{if(browserPending)onCancelBrowserSignIn?.();}} onSubmit={event=>void submit(event)} noValidate>
    {compact ? <div className="agentlens-demo-auth-fields">{fields}</div> : fields}
    {compact ? <div className="agentlens-demo-auth-actions">
    <button type="button" disabled={busy} onClick={()=>{if(resetView)changeResetView(false);else onBack();}}>Back</button>
    {submitAction}
    </div> : submitAction}
   </form>
   {!compact && <p className="agentlens-auth-mode-switch">{registration ? <>Already have an account? <button type="button" onClick={()=>onModeChange("login")} disabled={busy}>Sign In</button></> : <>Don't have an account? <button type="button" onClick={()=>onModeChange("register")} disabled={busy}>Sign Up</button></>}</p>}
  </section>
 </main>{!compact && resetPanel && <WorkbenchDialog compact textClose title="Reset your password" className="agentlens-demo-auth-dialog agentlens-password-reset-dialog" onClose={()=>changeResetView(false)}>{resetPanel}</WorkbenchDialog>}</>;
}
