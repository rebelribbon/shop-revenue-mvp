"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signUpOwner } from "@/server/actions/signup";
export function SignupForm() {
  const [state, action, pending] = useActionState(signUpOwner, null);
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
      />
      <label htmlFor="signup-password">Create a password</label>
      <input
        id="signup-password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={128}
        required
      />
      <p className="muted">Use at least 12 characters.</p>
      <button className="btn primary" disabled={pending}>
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
