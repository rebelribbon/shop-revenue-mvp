"use client";
import { useActionState } from "react";
import { createPreviewOwnerAccount, type AuthFormState } from "@/server/actions/auth";

export function OwnerSetupForm() {
  const [state, action, pending] = useActionState(createPreviewOwnerAccount, null as AuthFormState | null);
  return (
    <form action={action} className="card">
      <label htmlFor="password">Choose a password</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      <label htmlFor="confirmPassword">Confirm password</label>
      <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
      <button className="btn primary" disabled={pending}>{pending ? "Creating…" : "Create preview owner account"}</button>
      {state && <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>{state.message}</p>}
    </form>
  );
}
