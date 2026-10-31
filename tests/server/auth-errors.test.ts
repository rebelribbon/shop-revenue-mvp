import { describe, expect, it } from "vitest";
import {
  authServiceUnavailable,
  signInFailureMessage,
} from "@/lib/auth-errors";

describe("authentication provider failures", () => {
  it("does not blame a password when the provider rejects the application key", () => {
    expect(signInFailureMessage({ status: 401 })).toContain("unavailable");
    expect(authServiceUnavailable({ status: 401 })).toBe(true);
  });

  it("reports delivery restrictions, throttling and transport failures as unavailable", () => {
    for (const error of [
      { status: 400, code: "email_address_not_authorized" },
      { status: 429, code: "over_email_send_rate_limit" },
      { status: 503 },
      { name: "AuthRetryableFetchError" },
    ])
      expect(authServiceUnavailable(error)).toBe(true);
  });

  it("keeps credential errors and unknown accounts indistinguishable", () => {
    expect(
      signInFailureMessage({ status: 400, code: "invalid_credentials" }),
    ).toBe(signInFailureMessage({ status: 400, code: "user_not_found" }));
    expect(
      signInFailureMessage({ status: 401, code: "invalid_credentials" }),
    ).toBe("Email or password is incorrect.");
    expect(
      authServiceUnavailable({ status: 400, code: "user_not_found" }),
    ).toBe(false);
  });
});
