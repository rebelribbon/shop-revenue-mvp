import "server-only";
import { z } from "zod";
import { publicSignupEnabled } from "./billing";

const emailInput = z.string().trim().toLowerCase().max(254).pipe(z.email());

// Exact addresses only. This grants eligibility to create a new shop; the
// recipient must still verify their own email before any shop is enrolled.
export function pilotOwnerEmail(value: unknown): string | null {
  const email = emailInput.safeParse(value);
  if (!email.success) return null;
  const allowed = (process.env.PILOT_OWNER_SIGNUP_EMAILS ?? "")
    .split(",")
    .some((entry) => {
      const parsed = emailInput.safeParse(entry);
      return parsed.success && parsed.data === email.data;
    });
  return allowed ? email.data : null;
}

export function shopSignupEnabledFor(email?: string | null): boolean {
  return publicSignupEnabled() || pilotOwnerEmail(email) !== null;
}
