// Server-side Sentry for the web app (Section 20). No-op without SENTRY_DSN.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initServerObservability } = await import("./lib/observability");
    initServerObservability("web");
  }
}
