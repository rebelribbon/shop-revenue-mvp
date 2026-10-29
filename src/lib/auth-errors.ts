type AuthFailure = { status?: number; code?: string; name?: string };

// Provider configuration and delivery failures must not look like bad passwords
// or a successfully sent email. Do not expose provider messages or user existence.
export function authServiceUnavailable(error: AuthFailure): boolean {
  return (
    (error.status !== undefined &&
      (error.status >= 500 || [401, 403, 429].includes(error.status))) ||
    error.name === "AuthRetryableFetchError" ||
    [
      "email_address_not_authorized",
      "over_email_send_rate_limit",
      "over_request_rate_limit",
      "unexpected_failure",
      "request_timeout",
    ].includes(error.code ?? "")
  );
}

export function signInFailureMessage(error: AuthFailure): string {
  // Keep rejected credentials generic even if a provider uses HTTP 401.
  if (error.code === "invalid_credentials") return "Email or password is incorrect.";
  return authServiceUnavailable(error)
    ? "Sign-in is unavailable right now. Please try again shortly."
    : "Email or password is incorrect.";
}
