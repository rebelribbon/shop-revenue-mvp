import { ingestWebhookEvent } from "@/db/tenant";
import { logger } from "../logger";

export async function storeWebhook(
  input: Parameters<typeof ingestWebhookEvent>[0],
) {
  const r = await ingestWebhookEvent(input);
  logger.info({
    event: "webhook.received",
    provider: input.provider,
    eventType: input.eventType,
    webhookEventId: r.eventId,
    duplicate: r.duplicate,
  });
  return r;
}

export const rejected = (provider: string, reason: string) => {
  logger.warn({ event: "webhook.rejected", provider, reason });
  return new Response("invalid signature", { status: 400 });
};

export const notConfigured = (provider: string) => {
  // Never accept unsigned events because a secret is missing.
  logger.error({ event: "webhook.not_configured", provider, alert: true });
  return new Response("webhook not configured", { status: 503 });
};

// The URL the provider signed: our public base URL plus the path and query.
export const publicUrl = (req: Request) => {
  const u = new URL(req.url);
  const base = (process.env.APP_BASE_URL ?? u.origin).replace(/\/$/, "");
  return `${base}${u.pathname}${u.search}`;
};
