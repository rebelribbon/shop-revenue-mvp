// Sentry error reporting and tracing (Section 20) for the web app and the worker.
// Disabled unless SENTRY_DSN is set: BLOCKED until the Sentry project exists.
import * as Sentry from "@sentry/node";
import { logger } from "./logger";

let started = false;
export function initServerObservability(service: "web" | "worker") {
  if (started) return;
  started = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.warn({ event: "observability.sentry_disabled", service, reason: "SENTRY_DSN not set" });
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.APP_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    initialScope: { tags: { service } },
    beforeSend(event) {
      // Never ship request bodies, cookies or user PII (Section 20).
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.cookie;
          delete event.request.headers.authorization;
        }
      }
      delete event.user;
      return event;
    },
  });
}

export function reportError(err: unknown, context: { requestId?: string; businessId?: string | null; action?: string }) {
  logger.error({ event: "error", ...context, err: err instanceof Error ? err.message : String(err) });
  if (process.env.SENTRY_DSN) Sentry.captureException(err, { tags: { requestId: context.requestId, businessId: context.businessId ?? undefined, action: context.action } });
}
