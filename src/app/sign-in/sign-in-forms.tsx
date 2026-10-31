"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signInWithPassword, type AuthFormState } from "@/server/actions/auth";

export function SignInForms({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    signInWithPassword,
    null as AuthFormState | null,
  );

  return (
    <div className="card">
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <button className="btn primary" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {state && (
          <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>
            {state.message}
          </p>
        )}
      </form>
      <p className="muted">
        <Link href="/forgot-password">Forgot password?</Link>
      </p>
    </div>
  );
}
