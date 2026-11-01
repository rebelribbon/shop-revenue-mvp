"use client";
import { useActionState } from "react";
import { updatePassword, type AuthFormState } from "@/server/actions/auth";

export function ResetPasswordForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    updatePassword,
    null as AuthFormState | null,
  );
  return (
    <form action={action} className="card">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password">New password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <label htmlFor="confirmPassword">Confirm password</label>
      <input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <button className="btn primary" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </button>
      {state && (
        <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
