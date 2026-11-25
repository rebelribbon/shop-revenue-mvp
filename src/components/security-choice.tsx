"use client";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  sendSecondStepCode,
  verifySecondStepCode,
} from "@/server/actions/email-security";
import { useActionHydration } from "./action-hydration";
import { Authenticator } from "./authenticator";

export function SecurityChoice({
  factors,
  next,
  verified,
  canEmail,
  method,
  passwordVerified,
  settings = false,
  internal = false,
}: {
  factors: { id: string; name: string }[];
  next: string;
  verified: boolean;
  canEmail: boolean;
  method: "email" | "authenticator" | null;
  passwordVerified: boolean;
  settings?: boolean;
  internal?: boolean;
}) {
  const [choice, setChoice] = useState<"email" | "authenticator">(
    internal || !canEmail ? "authenticator" : (method ?? "email"),
  );
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [state, action, verifying] = useActionState(verifySecondStepCode, null);
  const ready = useActionHydration();
  return (
    <div className="stack">
      {settings && (
        <p>
          <Link href="/app">Back to workspace</Link>
        </p>
      )}
      <section className="card" data-ux-ready={ready}>
        <h1>{settings ? "Sign-in security" : "Two-step verification"}</h1>
        <p>
          After your password, verify with an email code or an authenticator
          app.
        </p>
        {method && (
          <p>
            Current method:{" "}
            <strong>
              {method === "email" ? "Email code" : "Authenticator app"}
            </strong>
            .
          </p>
        )}
        {!internal && (
          <div
            className="row"
            role="group"
            aria-label="Verification method"
          >
            <button
              type="button"
              className="btn secondary"
              aria-pressed={choice === "email"}
              disabled={!canEmail}
              onClick={() => setChoice("email")}
            >
              Email code
            </button>
            <button
              type="button"
              className="btn secondary"
              aria-pressed={choice === "authenticator"}
              onClick={() => setChoice("authenticator")}
            >
              Authenticator app
            </button>
          </div>
        )}
        {!canEmail && !internal && (
          <p>
            Verify your current authenticator first. You can then choose email
            codes in Security settings.
          </p>
        )}
        {choice === "email" &&
          (!passwordVerified ? (
            <p>
              <Link
                className="btn primary"
                href={`/sign-in?reauth=1&next=${encodeURIComponent(settings ? "/verify?settings=1" : next)}`}
              >
                Sign in with your password
              </Link>
            </p>
          ) : (
            <>
              <p>
                Read the code on any device, then enter it here to finish this
                sign-in. Each code expires in 10 minutes.
              </p>
              <button
                type="button"
                className={`btn ${sent ? "secondary" : "primary"}`}
                disabled={!ready || pending}
                onClick={() =>
                  start(async () => {
                    const result = await sendSecondStepCode(
                      settings && method !== "email",
                    );
                    setMessage(result.message);
                    if (result.ok) setSent(true);
                  })
                }
              >
                {pending
                  ? "Sending…"
                  : sent
                    ? "Send a new code"
                    : "Send verification code"}
              </button>
              {sent && (
                <form action={action}>
                  <input type="hidden" name="next" value={next} />
                  <label htmlFor="email-second-step">
                    Email verification code
                  </label>
                  <input
                    id="email-second-step"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                  <button className="btn primary" disabled={verifying}>
                    {verifying ? "Verifying…" : "Verify and continue"}
                  </button>
                  {state && (
                    <p className="notice error" role="status">
                      {state.message}
                    </p>
                  )}
                </form>
              )}
              {message && <p role="status">{message}</p>}
            </>
          ))}
      </section>
      {choice === "authenticator" && (
        <Authenticator factors={factors} next={next} verified={verified} />
      )}
      {choice === "email" && (
        <form action="/auth/sign-out" method="post">
          <button className="btn secondary">Sign out</button>
        </form>
      )}
    </div>
  );
}
