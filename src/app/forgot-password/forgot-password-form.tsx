"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  requestPasswordReset,
  verifyPasswordRecoveryCode,
  type AuthFormState,
} from "@/server/actions/auth";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    null as AuthFormState | null,
  );
  const [email, setEmail] = useState("");
  const [verification, verify, verifying] = useActionState(
    verifyPasswordRecoveryCode,
    null as AuthFormState | null,
  );
  return (
    <div className="card">
      <form action={action}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <button className="btn primary" disabled={pending}>
          {pending ? "Sending…" : "Send reset instructions"}
        </button>
        {state && (
          <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>
            {state.message}
          </p>
        )}
      </form>
      <form action={verify}>
        <h2>Already have a recovery code?</h2>
        <p>Enter the email and six-digit code from your newest reset email. You can do this on another device.</p>
        <label htmlFor="recovery-email">Account email</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="recovery-code">Recovery code</label>
        <input id="recovery-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
        <button className="btn primary" disabled={verifying}>{verifying ? "Verifying…" : "Verify code"}</button>
        {verification && <p role="status" className="notice error">{verification.message}</p>}
      </form>
      <p className="muted">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </div>
  );
}
