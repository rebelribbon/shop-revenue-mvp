// Twilio inbound SMS (Section 11): signature validated, persisted, 200 with
// empty TwiML immediately; processed by the worker (handleInboundSms, M5).
// Milestone 1 validates against the primary account token; per-shop
// subaccount tokens arrive with Milestone 5.
import { verifyTwilioSignature } from "@/lib/webhooks/signatures";
import { notConfigured, publicUrl, rejected, storeWebhook } from "@/lib/webhooks/ingest";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return notConfigured("twilio");
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  if (!verifyTwilioSignature(publicUrl(req), params, req.headers.get("x-twilio-signature"), token)) return rejected("twilio", "signature");
  if (!params.MessageSid) return rejected("twilio", "shape");
  await storeWebhook({ provider: "twilio", providerEventId: params.MessageSid, eventType: "sms.inbound", payload: params });
  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
