// Postmark bounce/complaint/delivery webhooks (Section 11), Basic-auth protected.
import { verifyBasicAuth } from "@/lib/webhooks/signatures";
import { notConfigured, rejected, storeWebhook } from "@/lib/webhooks/ingest";

export async function POST(req: Request) {
  const user = process.env.POSTMARK_WEBHOOK_USERNAME;
  const pass = process.env.POSTMARK_WEBHOOK_PASSWORD;
  if (!user || !pass) return notConfigured("postmark");
  if (!verifyBasicAuth(req.headers.get("authorization"), user, pass)) return rejected("postmark", "auth");
  const event = (await req.json().catch(() => null)) as { RecordType?: string; ID?: number | string; MessageID?: string } | null;
  const id = event?.ID ?? event?.MessageID;
  if (!event?.RecordType || id === undefined) return rejected("postmark", "shape");
  await storeWebhook({ provider: "postmark", providerEventId: `${event.RecordType}:${id}`, eventType: event.RecordType, payload: event });
  return Response.json({ received: true });
}
