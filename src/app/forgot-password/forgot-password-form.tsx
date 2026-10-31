"use client";
import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  type AuthFormState,
} from "@/server/actions/auth";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
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
      <p className="muted">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </div>
  );
}
