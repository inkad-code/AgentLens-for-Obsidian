import { useState, useId, type FormEvent } from "react";
import type { EmailCredentials } from "../../auth/AuthService";
import { validRegistrationPassword } from "../../auth/PasswordPolicy";
import { authAssets } from "./authAssets";
import { FeedbackIcon } from "./FeedbackIcon";
import { message } from "./shared";

export function EmailAuthPage({mode,busy,browserPending,browserOpening,browserError,onBack,onModeChange,onSubmit,onBrowserSignIn,onPasswordReset}: {
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
 const feedbackId=useId();
 const [invalidField,setInvalidField]=useState<"password"|"confirm"|null>(null);
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [name,setName]=useState("");
 const [confirm,setConfirm]=useState("");
 const [agreed,setAgreed]=useState(false);
 const [visible,setVisible]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const [resetBusy,setResetBusy]=useState(false);
 const registration=mode==='register';
 async function resetPassword() {
  if(!email.trim()){setError("Enter your email address first.");return;}
  setResetBusy(true);setError(null);setNotice(null);
  try{await onPasswordReset(email.trim());setNotice("If an account uses this email, you’ll receive a reset link. Check your inbox.");}catch(caught){setError(message(caught,"auth"));}finally{setResetBusy(false);}
 }
 async function submit(event:FormEvent) {
  event.preventDefault();if(busy)return;setError(null);setNotice(null);setInvalidField(null);
  if(registration && password!==confirm){setError("Passwords do not match.");setInvalidField("confirm");return;}
  if(registration && !validRegistrationPassword(password)){setError("The password must be at least 8 characters and include a letter, a number, and a special character.");setInvalidField("password");return;}
  try {await onSubmit({email:email.trim(),password,...(registration?{name:name.trim()}: {})});}
  catch(caught){setError(message(caught,"auth"));}
  finally {setPassword("");setConfirm("");}
 }
 return <main className={`agentlens-auth-page ${registration ? "is-register" : "is-login"}`}>
  <section className="agentlens-auth-hero">
   <button type="button" className="agentlens-auth-back" onClick={onBack}><img src={authAssets.imgIconBack} alt="" />Back</button>
   <div className="agentlens-auth-hero-content">
    <h2>{registration ? "Sign up to unlock monthly perks" : "Sign In to unlock monthly perks"}</h2>
    <div className="agentlens-auth-benefits" aria-label="Account benefits">
     <div><i><img src={authAssets.benefitCredits} alt="" /></i><strong>20 Free Credits<br />Monthly</strong></div>
     <div><i><img src={authAssets.benefitAutoTag} alt="" /></i><strong>Rename &amp;<br />Auto-Tag</strong></div>
     <div><i><img src={authAssets.benefitSocialEagle} alt="" /></i><strong>From Social<br />Media to Obsidian</strong></div>
    </div>
    <small>* 1 import action = 1 credit</small>
   </div>
  </section>
  <section className="agentlens-auth-form" aria-label={registration?'Create your account':'Sign in to your account'}>
   <button type="button" className="agentlens-google-auth" onClick={()=>{setError(null);setNotice(null);onBrowserSignIn();}} disabled={browserPending ? browserOpening : busy}><img src={authAssets.imgFrame} alt="" />{browserPending?'Open Google sign-in again':browserError?'Try Google sign-in again':registration?'Sign up with Google':'Sign in with Google'}</button>
   <div className="agentlens-auth-divider"><span>or</span></div>
   <form onSubmit={event=>void submit(event)}>
    {registration && <label>Full name <em>*</em><input autoComplete="name" value={name} onChange={event=>setName(event.currentTarget.value)} placeholder="e.g. John Doe" required disabled={busy} /></label>}
    <label>Email <em>*</em><input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.currentTarget.value)} required disabled={busy} /></label>
    <div className="agentlens-password-label"><label htmlFor={passwordId}>Password <em>*</em></label>{!registration && <button type="button" onClick={()=>void resetPassword()} disabled={busy || resetBusy}>Forgot your password?</button>}
     <div className="agentlens-password-input"><input id={passwordId} aria-invalid={invalidField === "password" || undefined} aria-describedby={registration ? `${passwordId}-hint${invalidField === "password" ? ` ${feedbackId}` : ""}` : undefined} type={visible?'text':'password'} autoComplete={registration?'new-password':'current-password'} value={password} onChange={event=>{setPassword(event.currentTarget.value);if(invalidField === "password"){setInvalidField(null);setError(null);}}} required minLength={registration?8:undefined} disabled={busy} /><button type="button" aria-label={visible?'Hide password':'Show password'} aria-pressed={visible} onClick={()=>setVisible(!visible)}><FeedbackIcon name={visible ? "eye-off" : "eye"} className="agentlens-password-icon" strokeWidth={1.8} /></button></div>
    </div>
    {registration && <><small id={`${passwordId}-hint`}>Minimum 8 characters with letters, numbers, and special characters</small><label>Confirm password <em>*</em><input aria-invalid={invalidField === "confirm" || undefined} aria-describedby={invalidField === "confirm" ? feedbackId : undefined} type="password" autoComplete="new-password" placeholder="Re-enter your password" value={confirm} onChange={event=>{setConfirm(event.currentTarget.value);if(invalidField === "confirm"){setInvalidField(null);setError(null);}}} required disabled={busy} /></label><label className="agentlens-auth-terms"><input type="checkbox" style={{backgroundImage:agreed ? `url("${authAssets.imgCheck}")` : undefined}} checked={agreed} onChange={event=>setAgreed(event.currentTarget.checked)} required disabled={busy} />I agree to the <a href="https://agentlensapi.io/terms" target="_blank" rel="noreferrer">Terms of Use</a> and <a href="https://agentlensapi.io/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></label></>}
    {notice && <p role="status">{notice}</p>}
    {browserPending && <p role="status">Finish Google sign-in in your browser, then return to Obsidian. Sign-in will finish automatically.</p>}
    {(error || browserError) && <p id={feedbackId} className="agentlens-inline-error" role="alert">{error || browserError}</p>}
    <button type="submit" className="mod-cta" disabled={busy}>{browserPending?'Waiting for Google…':busy ? registration ? 'Creating account…' : 'Signing in…' : registration ? 'Create account' : 'Continue'}</button>
   </form>
   <p className="agentlens-auth-mode-switch">{registration ? <>Already have an account? <button type="button" onClick={()=>onModeChange("login")} disabled={busy}>Sign In</button></> : <>Don't have an account? <button type="button" onClick={()=>onModeChange("register")} disabled={busy}>Sign Up</button></>}</p>
  </section>
 </main>;
}
