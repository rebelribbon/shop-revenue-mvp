import { AppError } from "./errors";
import { paymentBaseUrl } from "./stripe";
import { isWellFormedToken, safeEqual } from "./tokens";

export const STRIPE_CONNECT_CALLBACK = "/stripe/connect/callback";
export const STRIPE_CONNECT_TTL_SECONDS = 600;
export function stripeConnectConfigured() {
  return /^ca_[A-Za-z0-9]{8,}$/.test(
    process.env.STRIPE_CONNECT_CLIENT_ID ?? "",
  );
}
export const stripeConnectCookieName = () =>
  ["local", "test"].includes(process.env.APP_ENV ?? "local")
    ? "stripe_connect_state"
    : "__Host-stripe_connect_state";
export const stripeConnectCookieOptions = () => ({
  httpOnly: true,
  secure: !["local", "test"].includes(process.env.APP_ENV ?? "local"),
  sameSite: "lax" as const,
  path: "/",
  maxAge: STRIPE_CONNECT_TTL_SECONDS,
});
export function validStripeConnectState(state: string, cookie: string) {
  return (
    isWellFormedToken(state) &&
    isWellFormedToken(cookie) &&
    safeEqual(state, cookie)
  );
}
export function stripeConnectAuthorizationUrl(state: string) {
  if (!stripeConnectConfigured())
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Stripe sign-in is waiting for activation. Please try again later.",
    );
  if (!isWellFormedToken(state))
    throw new AppError("VALIDATION", "Invalid Stripe connection request.");
  const url = new URL("https://connect.stripe.com/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.STRIPE_CONNECT_CLIENT_ID!,
    scope: "read_write",
    state,
    stripe_landing: "login",
    redirect_uri: new URL(STRIPE_CONNECT_CALLBACK, paymentBaseUrl()).href,
  }).toString();
  return url.href;
}
