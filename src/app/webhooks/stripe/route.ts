// Stripe Connect webhook endpoint (Section 11): verify, store first, 200.
// Mapping to payments arrives with Milestone 4; until then events are stored
// and marked ignored by the worker.
import { verifyStripeSignature } from "@/lib/webhooks/signatures";
import { notConfigured, rejected, storeWebhook } from "@/lib/webhooks/ingest";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return notConfigured("stripe");
  const body = await req.text();
  if (!verifyStripeSignature(body, req.headers.get("stripe-signature"), secret)) return rejected("stripe", "signature");
  const event = JSON.parse(body) as { id?: string; type?: string };
  if (!event.id || !event.type) return rejected("stripe", "shape");
  await storeWebhook({ provider: "stripe", providerEventId: event.id, eventType: event.type, payload: event });
  return Response.json({ received: true });
}
