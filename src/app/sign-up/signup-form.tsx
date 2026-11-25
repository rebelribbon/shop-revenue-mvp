"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { signUpOwner } from "@/server/actions/signup";
export function SignupForm({ invitedEmail }: { invitedEmail?: string }) {
  const [state, action, pending] = useActionState(signUpOwner, null);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  return (
    <form action={action} className="card">
      <label htmlFor="signup-email">Email</label>
      <input
        id="signup-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        defaultValue={invitedEmail}
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
      <button type="button" className="btn secondary" onClick={() => setVisible(!visible)}>{visible ? "Hide password" : "Show password"}</button>
      <p id="signup-password-hint" className="muted" aria-live="polite">{password.length >= 12 ? "Password length requirement met." : "Use at least 12 characters."}</p>
      <button className="btn primary" disabled={pending || password.length < 12}>
        {pending ? "Creating login…" : "Create login"}
      </button>
      {state && (
        <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>
          {state.message}
        </p>
      )}
      {state?.ready && (
        <p>
          <Link href="/start">Continue to set up your shop</Link>
        </p>
      )}
    </form>
  );
}
