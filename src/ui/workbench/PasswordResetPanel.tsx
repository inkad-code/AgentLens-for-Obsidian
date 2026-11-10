import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { message } from "./shared";
import back from "./assets/password-reset/back.svg";

/** Shared Figma recovery states for the full login page and the demo dialog. */
export function PasswordResetPanel({ email, onEmailChange, onBack, onClose, onPasswordReset, busy }: {
  email: string;
  onEmailChange: (email: string) => void;
  onBack: () => void;
  onClose: () => void;
  onPasswordReset: (email: string) => Promise<string>;
  busy: boolean;
}) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const feedbackId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    if (sending) return;
    if (sent) close.current?.focus(); else input.current?.focus();
  }, [sent, sending]);
  function goBack() { if (sent) { setSent(false); setError(null); } else onBack(); }
  async function send() {
    if (busy || inFlight.current) return;
    setError(null);
    if (!email.trim() || !input.current?.validity.valid) {
      setError(email.trim() ? "Enter a valid email address." : "Enter your email address first.");
      input.current?.focus();
      return;
    }
    inFlight.current = true; setSending(true);
    try { await onPasswordReset(email.trim()); if (mounted.current) setSent(true); }
    catch (caught) { if (mounted.current) setError(message(caught, "auth")); }
    finally { inFlight.current = false; if (mounted.current) setSending(false); }
  }
  return <section className={`agentlens-password-reset-panel${sent ? " is-sent" : ""}`} aria-label="Reset your password">
    <button type="button" className="agentlens-reset-back" aria-label="Back to previous step" disabled={busy || sending} onClick={goBack}><img src={back} width="16" height="16" alt="" />Back</button>
    {sent ? <>
      <div className="agentlens-reset-success" role="status"><p>Password reset email sent!</p><p>Check your inbox and follow the link.</p></div>
      <footer className="agentlens-reset-actions"><button type="button" onClick={goBack}>Back</button><button ref={close} type="button" className="mod-cta" onClick={onClose}>Close</button></footer>
    </> : <form noValidate onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className="agentlens-reset-fields">
        <h3>Reset your password</h3>
        <p>Enter your email and we'll send you a reset link.</p>
        <label>Email <em>*</em><input ref={input} type="email" autoComplete="email" required value={email} disabled={busy || sending} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? feedbackId : undefined} onChange={event => { onEmailChange(event.currentTarget.value); setError(null); }} /></label>
        {error && <p id={feedbackId} className="agentlens-inline-error" role="alert">{error}</p>}
      </div>
      <footer className="agentlens-reset-actions"><button type="button" disabled={busy || sending} onClick={goBack}>Back</button><button type="submit" className="mod-cta" disabled={busy || sending}>{sending ? "Sending…" : "Send reset link"}</button></footer>
    </form>}
  </section>;
}
