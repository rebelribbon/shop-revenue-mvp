import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { AppError } from "./errors";

// The one phone normalization function (Section 8): libphonenumber, default
// region US. Invalid input is rejected, never stored raw.
export function normalizePhone(input: string): string {
  const parsed = parsePhoneNumberFromString(input.trim(), "US");
  if (!parsed || !parsed.isValid()) throw new AppError("VALIDATION", "That phone number doesn't look right.", { field: "phone" });
  return parsed.number;
}

export function tryNormalizePhone(input: string): string | null {
  try {
    return normalizePhone(input);
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    throw new AppError("VALIDATION", "That email address doesn't look right.", { field: "email" });
  }
  return email;
}

// Last 4 digits only, for logs (Section 20).
export const maskPhone = (e164: string | null | undefined) => (e164 ? `***${e164.slice(-4)}` : null);
export const maskEmail = (email: string | null | undefined) =>
  email ? email.replace(/^(.).*(@.*)$/, (_, first: string, domain: string) => `${first}***${domain}`) : null;
