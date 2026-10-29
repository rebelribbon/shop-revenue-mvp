// Sentry error reporting and tracing (Section 20) for the web app and the worker.
// Disabled unless SENTRY_DSN is set: BLOCKED until the Sentry project exists.
import * as Sentry from "@sentry/node";
import { safeErrorDiagnostic } from "./errors";
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
    dataCollection:{userInfo:false,cookies:false,httpHeaders:false,httpBodies:[],urlQueryParams:false,databaseQueryData:false,queues:false,stackFrameVariables:false,frameContextLines:0,graphQL:{document:false,variables:false},genAI:{inputs:false,outputs:false}},
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    initialScope: { tags: { service } },
    beforeSend(event) {
      // Never ship request bodies, cookies or user PII (Section 20).
      delete event.request;
      delete event.user;
      delete event.extra;
      delete event.breadcrumbs;
      for(const value of event.exception?.values??[]){value.value='Application error; use the support reference.';for(const frame of value.stacktrace?.frames??[])delete frame.vars;}
      return event;
    },
  });
}

export function reportError(err: unknown, context: { requestId?: string; businessId?: string | null; action?: string }) {
  logger.error({ event: "error", ...context, ...safeErrorDiagnostic(err) });
  if (process.env.SENTRY_DSN) Sentry.captureException(new Error(safeErrorDiagnostic(err).errorName), { tags: { requestId: context.requestId, businessId: context.businessId ?? undefined, action: context.action } });
}

