// Provider webhook signature checks (Section 11). Invalid signatures are
// rejected before anything is stored.
import { createHmac } from "node:crypto";
import { safeEqual } from "../tokens";

// Stripe: header "t=<unix>,v1=<hex hmac-sha256 of `${t}.${body}`>[,v1=...]".
export function verifyStripeSignature(
  body: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
  now = Date.now(),
) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (
    !t ||
    !/^\d+$/.test(t) ||
    !Number.isSafeInteger(Number(t)) ||
    !sigs.length ||
    Math.abs(now / 1000 - Number(t)) > toleranceSeconds
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${t}.${body}`)
    .digest("hex");
  return sigs.some((s) => safeEqual(s, expected));
}

// Twilio: X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sorted key+value pairs)).
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  header: string | null,
  authToken: string,
) {
  if (!header) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", authToken)
    .update(data, "utf8")
    .digest("base64");
  return safeEqual(header, expected);
}

// Postmark: HTTP Basic credentials configured on the webhook URL.
export function verifyBasicAuth(
  header: string | null,
  username: string,
  password: string,
) {
  if (!header?.startsWith("Basic ")) return false;
  const expected = Buffer.from(`${username}:${password}`).toString("base64");
  return safeEqual(header.slice(6), expected);
}
