"use client";
import { useActionState, useState } from "react";
import { updatePassword, type AuthFormState } from "@/server/actions/auth";

export function ResetPasswordForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(
    updatePassword,
    null as AuthFormState | null,
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  return (
    <form action={action} className="card">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password">New password</label>
      <input
        id="password"
        name="password"
        type={visible ? "text" : "password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        minLength={12}
        maxLength={128}
        required
      />
      <label htmlFor="confirmPassword">Confirm password</label>
      <input
        id="confirmPassword"
        name="confirmPassword"
        type={visible ? "text" : "password"}
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        autoComplete="new-password"
        minLength={12}
        maxLength={128}
        required
      />
      <button type="button" className="btn secondary" onClick={() => setVisible(!visible)}>{visible ? "Hide passwords" : "Show passwords"}</button>
      <p className="muted" aria-live="polite">{password.length < 12 ? "Use at least 12 characters." : confirmation !== password ? "Confirm the same password." : "Passwords match."}</p>
      <button className="btn primary" disabled={pending || password.length < 12 || confirmation !== password}>
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
