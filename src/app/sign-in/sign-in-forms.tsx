"use client";
import { useActionState, useState } from "react";
import { sendEmailLink, sendSmsCode, verifySmsCode, type AuthFormState } from "@/server/actions/auth";

export function SignInForms({ next }: { next: string }) {
  const [method, setMethod] = useState<"email" | "sms">("email");
  const [emailState, emailAction, emailPending] = useActionState(sendEmailLink, null as AuthFormState | null);
  const [smsState, smsAction, smsPending] = useActionState(sendSmsCode, null as AuthFormState | null);
  const [codeState, codeAction, codePending] = useActionState(verifySmsCode, null as AuthFormState | null);
  const awaitingCode = smsState?.step === "code" || codeState?.step === "code";
  const phone = codeState?.phone ?? smsState?.phone ?? "";

  return (
    <div className="card">
      {method === "email" ? (
        <form action={emailAction}>
          <input type="hidden" name="next" value={next} />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <button className="btn primary" disabled={emailPending}>{emailPending ? "Sending…" : "Email me a sign-in link"}</button>
          {emailState && <p role="status" className={`notice ${emailState.ok ? "ok" : "error"}`}>{emailState.message}</p>}
        </form>
      ) : awaitingCode ? (
        <form action={codeAction}>
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="next" value={next} />
          <label htmlFor="code">6-digit code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
          <button className="btn primary" disabled={codePending}>{codePending ? "Checking…" : "Sign in"}</button>
          <p role="status" className={`notice ${codeState && !codeState.ok ? "error" : "ok"}`}>{codeState?.message ?? smsState?.message}</p>
        </form>
      ) : (
        <form action={smsAction}>
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required />
          <button className="btn primary" disabled={smsPending}>{smsPending ? "Sending…" : "Text me a code"}</button>
          {smsState && !smsState.ok && <p role="status" className="notice error">{smsState.message}</p>}
        </form>
      )}
      <button className="btn secondary" type="button" onClick={() => setMethod(method === "email" ? "sms" : "email")}>
        {method === "email" ? "Use my mobile number instead" : "Use my email instead"}
      </button>
    </div>
  );
}
