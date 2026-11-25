"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  signUpOwner,
  verifyOwnerEmailCode,
  resendOwnerConfirmation,
} from "@/server/actions/signup";
import { useActionHydration } from "@/components/action-hydration";
export function SignupForm({ invitedEmail }: { invitedEmail?: string }) {
  const [state, action, pending] = useActionState(signUpOwner, null);
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [verification, verify, verifying] = useActionState(
    verifyOwnerEmailCode,
    null,
  );
  const [resend, resendAction, resending] = useActionState(
    resendOwnerConfirmation,
    null,
  );
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [haveCode, setHaveCode] = useState(false);
  const ready = useActionHydration();
  const confirming = haveCode || (state?.ok && !state.ready);
  return (
    <div className="card" data-ux-ready={ready}>
      {!confirming ? (
        <form action={action}>
          <fieldset className="hydration-fields" disabled={!ready || pending}>
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={!!invitedEmail}
            />
            <label htmlFor="signup-password">Create a password</label>
            <input
              id="signup-password"
              name="password"
              type={visible ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="signup-password-hint"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
            <button
              type="button"
              className="btn secondary"
              onClick={() => setVisible(!visible)}
            >
              {visible ? "Hide password" : "Show password"}
            </button>
            <p id="signup-password-hint" className="muted" aria-live="polite">
              {password.length >= 12
                ? "Password length requirement met."
                : "Use at least 12 characters."}
            </p>
            <button
              className="btn primary"
              disabled={pending || password.length < 12}
            >
              {pending ? "Creating login…" : "Create login"}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setHaveCode(true)}
            >
              I already have a confirmation code
            </button>
          </fieldset>
        </form>
      ) : (
        <>
          <h2>Confirm your email</h2>
          <p>
            Check your email. Open the confirmation link on any device, or enter
            its six-digit code here.
          </p>
          <form action={verify}>
            <fieldset
              className="hydration-fields"
              disabled={!ready || verifying}
            >
              <label htmlFor="confirmation-email">Email</label>
              <input
                id="confirmation-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={!!invitedEmail}
                required
              />
              <label htmlFor="confirmation-code">Confirmation code</label>
              <input
                id="confirmation-code"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
              <button className="btn primary" disabled={verifying}>
                {verifying ? "Verifying…" : "Verify email"}
              </button>
            </fieldset>
            {verification && (
              <p role="status" className="notice error">
                {verification.message}
              </p>
            )}
          </form>
          <form action={resendAction}>
            <input type="hidden" name="email" value={email} />
            <button className="btn secondary" disabled={!ready || resending}>
              {resending ? "Sending…" : "Resend confirmation email"}
            </button>
            {resend && <p role="status">{resend.message}</p>}
          </form>
        </>
      )}
      {state && (
        <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>
          {state.message}
        </p>
      )}
      {state?.ready && (
        <p>
          <Link href="/start">Continue to set up your business</Link>
        </p>
      )}
    </div>
  );
}
