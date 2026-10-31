// Standard Webhooks signature verification (used by Supabase Auth hooks).
// Secret format "v1,whsec_<base64>"; signed content "{id}.{timestamp}.{body}".
import { createHmac } from "node:crypto";
import { safeEqual } from "./tokens";

export function verifyStandardWebhook(
  secret: string,
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
  body: string,
  toleranceSeconds = 300,
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (
    !Number.isFinite(ts) ||
    Math.abs(Date.now() / 1000 - ts) > toleranceSeconds
  )
    return false;
  const key = Buffer.from(
    secret.replace(/^v1,/, "").replace(/^whsec_/, ""),
    "base64",
  );
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${body}`)
    .digest("base64");
  return headers.signature
    .split(" ")
    .map((s) => s.split(",")[1] ?? "")
    .some((sig) => safeEqual(sig, expected));
}
