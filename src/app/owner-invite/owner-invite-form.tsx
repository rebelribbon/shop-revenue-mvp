"use client";
import { useActionState } from "react";
import { sendPilotOwnerInvite } from "@/server/actions/signup";

export function OwnerInviteForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(sendPilotOwnerInvite, null);
  return (
    <form action={action} className="card">
      <label htmlFor="owner-invite-email">Email</label>
      <input
        id="owner-invite-email"
        type="email"
        name="email"
        autoComplete="email"
        value={email}
        readOnly
        required
      />
      <button className="btn primary" disabled={pending || state?.ok === true}>
        {pending ? "Sending invitation…" : "Send invitation"}
      </button>
      {state && (
        <p role="status" className={`notice ${state.ok ? "ok" : "error"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
