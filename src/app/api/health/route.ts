// Health route for the deployed M1 web runtime.
//
// The original M1 design treated an always-on Graphile Worker heartbeat as part
// of web health. The hosted design-partner environment intentionally defers the
// paid always-on worker runtime until a milestone requires provider-specific
// asynchronous processing. For M1, this endpoint therefore reports the health
// of the deployed web service and its required database dependency only.
import { pingDatabase } from "@/db/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await pingDatabase();
    return Response.json(
      {
        status: "ok",
        database: { ok: true, latencyMs: Date.now() - started },
        backgroundProcessing: { mode: "deferred", requiredForM1: false },
        version: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? "dev",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Keep health responses and logs free of connection strings, credentials,
    // query text, and customer data while still making hosted failures diagnosable.
    const safeError = error && typeof error === "object" ? (error as { name?: unknown; code?: unknown }) : null;
    console.error(
      JSON.stringify({
        event: "health.database_unavailable",
        errorName: typeof safeError?.name === "string" ? safeError.name : "UnknownError",
        errorCode: typeof safeError?.code === "string" ? safeError.code : null,
      }),
    );
    return Response.json(
      { status: "down", database: { ok: false } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
