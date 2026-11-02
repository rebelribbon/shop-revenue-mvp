// Verify the raw body, durably store, then apply before acknowledging. A failed
// application returns 503 so Stripe retries even when no hosted worker runs.
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { webhookEvent } from "@/db/schema";
import { withGlobalWorker } from "@/db/tenant";
import { routeStripeEvent } from "@/domain/stripe-events";
import { verifyStripeSignature } from "@/lib/webhooks/signatures";
import { notConfigured, rejected, storeWebhook } from "@/lib/webhooks/ingest";
import { logger } from "@/lib/logger";
export async function POST(req: Request) {
  // Stripe signs connected-account events (shop invoice payments) and your own
  // account's events (shop subscriptions) from separate endpoints/secrets.
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_BILLING_WEBHOOK_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (!secrets.length) return notConfigured("stripe");
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!secrets.some((s) => verifyStripeSignature(body, signature, s)))
    return rejected("stripe", "signature");
  let event: Stripe.Event;
  try {
    event = JSON.parse(body);
  } catch {
    return rejected("stripe", "json");
  }
  if (!event?.id || !event.type) return rejected("stripe", "shape");
  const stored = await storeWebhook({
    provider: "stripe",
    providerEventId: event.id,
    eventType: event.type,
    payload: event,
  });
  try {
    const applied = await routeStripeEvent(event);
    await withGlobalWorker((tx) =>
      tx
        .update(webhookEvent)
        .set({
          status: applied ? "applied" : "ignored",
          appliedAt: applied ? new Date() : null,
          lastError: null,
        })
        .where(eq(webhookEvent.id, stored.eventId)),
    );
    return Response.json({ received: true });
  } catch {
    logger.error({
      event: "stripe.webhook_apply_failed",
      webhookEventId: stored.eventId,
      alert: true,
    });
    return new Response("Payment processing will be retried", { status: 503 });
  }
}
