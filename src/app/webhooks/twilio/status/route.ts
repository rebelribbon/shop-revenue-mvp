// Twilio delivery status callbacks: one stored event per (MessageSid, status).
import { verifyTwilioSignature } from "@/lib/webhooks/signatures";
import {
  notConfigured,
  publicUrl,
  rejected,
  storeWebhook,
} from "@/lib/webhooks/ingest";

export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return notConfigured("twilio");
  const params = Object.fromEntries(
    new URLSearchParams(await req.text()),
  ) as Record<string, string>;
  if (
    !verifyTwilioSignature(
      publicUrl(req),
      params,
      req.headers.get("x-twilio-signature"),
      token,
    )
  )
    return rejected("twilio", "signature");
  if (!params.MessageSid || !params.MessageStatus)
    return rejected("twilio", "shape");
  await storeWebhook({
    provider: "twilio",
    providerEventId: `${params.MessageSid}:${params.MessageStatus}`,
    eventType: "sms.status",
    payload: params,
  });
  return new Response(null, { status: 204 });
}
