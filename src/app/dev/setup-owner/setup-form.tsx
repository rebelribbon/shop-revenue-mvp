"use client";
import { useActionState } from "react";
import { createPreviewOwnerAccount, finishPreviewOwnerSetup, type AuthFormState } from "@/server/actions/auth";

export function OwnerSetupForm() {
  const [state, action, pending] = useActionState(createPreviewOwnerAccount, null as AuthFormState | null);
  const [finishState, finishAction, finishing] = useActionState(
    async () => finishPreviewOwnerSetup(),
    null as AuthFormState | null,
  );

  return (
    <div className="stack">
      <form action={action} className="card">
        <label htmlFor="password">Choose a password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <label htmlFor="confirmPassword">Confirm password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
        <button className="btn primary" disabled={pending}>{pending ? "Creating…" : "Create preview owner account"}</button>
        {state && <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>{state.message}</p>}
      </form>

      <form action={finishAction} className="card">
        <h2>Finish setup</h2>
        <p className="muted">Already created the account? Connect it to the preview shop.</p>
        <button className="btn primary" disabled={finishing}>{finishing ? "Connecting…" : "Finish setup"}</button>
        {finishState && <p role="status" className={`notice ${finishState.ok ? "ok" : "error"}`}>{finishState.message}</p>}
      </form>
    </div>
  );
}
