"use client";
import { useActionState } from "react";
import {
  acceptInviteAction,
  startInviteSignIn,
  type AuthFormState,
} from "@/server/actions/auth";

export function InviteSignIn({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    startInviteSignIn,
    null as AuthFormState | null,
  );
  return (
    <form action={action} className="card">
      <input type="hidden" name="token" value={token} />
      <p>
        We’ll email account setup instructions to the address this invite was
        sent to. You’ll choose a password before joining the shop.
      </p>
      <button className="btn primary" disabled={pending}>
        {pending ? "Sending…" : "Send account setup email"}
      </button>
      {state && (
        <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export function AcceptInvite({
  token,
  suggestedName,
}: {
  token: string;
  suggestedName: string;
}) {
  const [state, action, pending] = useActionState(
    acceptInviteAction,
    null as AuthFormState | null,
  );
  return (
    <form action={action} className="card">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="displayName">Your name</label>
      <input
        id="displayName"
        name="displayName"
        defaultValue={suggestedName}
        required
        maxLength={100}
      />
      <button className="btn primary" disabled={pending}>
        {pending ? "Joining…" : "Accept invite"}
      </button>
      {state && !state.ok && (
        <p role="status" className="notice error">
          {state.message}
        </p>
      )}
    </form>
  );
}
