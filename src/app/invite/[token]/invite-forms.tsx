"use client";
import { useActionState } from "react";
import { acceptInviteAction, startInviteSignIn, verifySmsCode, type AuthFormState } from "@/server/actions/auth";

export function InviteSignIn({ token }: { token: string }) {
  const [state, action, pending] = useActionState(startInviteSignIn, null as AuthFormState | null);
  const [codeState, codeAction, codePending] = useActionState(verifySmsCode, null as AuthFormState | null);
  if (state?.step === "code" || codeState?.step === "code") {
    return (
      <form action={codeAction} className="card">
        <input type="hidden" name="phone" value={codeState?.phone ?? state?.phone ?? ""} />
        <input type="hidden" name="next" value={`/invite/${token}`} />
        <label htmlFor="code">6-digit code</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        <button className="btn primary" disabled={codePending}>Verify</button>
        <p role="status" className="notice">{codeState?.message ?? state?.message}</p>
      </form>
    );
  }
  return (
    <form action={action} className="card">
      <input type="hidden" name="token" value={token} />
      <p>First, prove it’s you: we’ll send a sign-in link or code to the address this invite was sent to.</p>
      <button className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send my sign-in link"}</button>
      {state && <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>{state.message}</p>}
    </form>
  );
}

export function AcceptInvite({ token, suggestedName }: { token: string; suggestedName: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, null as AuthFormState | null);
  return (
    <form action={action} className="card">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="displayName">Your name</label>
      <input id="displayName" name="displayName" defaultValue={suggestedName} required maxLength={100} />
      <button className="btn primary" disabled={pending}>{pending ? "Joining…" : "Accept invite"}</button>
      {state && !state.ok && <p role="status" className="notice error">{state.message}</p>}
    </form>
  );
}
