// Health route (M1; uptime checks in Section 25). No tenant data. 503 when the
// database is unreachable or the worker heartbeat is older than 3 minutes
// (Section 20 alert threshold); queue lag over 10 minutes is reported too.
import { sql } from "drizzle-orm";
import { runInContext } from "@/db/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const status = await runInContext(null, { type: "system", id: null }, (tx) =>
      tx.execute<{ last_heartbeat_at: string | null; oldest_due_job_at: string | null; due_jobs: string; failed_jobs: string }>(
        sql`SELECT * FROM app.worker_status()`,
      ),
    { retries: 0 });
    const row = status.rows[0];
    const heartbeatAge = row.last_heartbeat_at ? Math.round((Date.now() - new Date(row.last_heartbeat_at).getTime()) / 1000) : null;
    const queueLag = row.oldest_due_job_at ? Math.max(0, Math.round((Date.now() - new Date(row.oldest_due_job_at).getTime()) / 1000)) : 0;
    const workerOk = heartbeatAge !== null && heartbeatAge <= 180;
    const body = {
      status: workerOk && queueLag <= 600 ? "ok" : "degraded",
      database: { ok: true, latencyMs: Date.now() - started },
      worker: { ok: workerOk, lastHeartbeatAt: row.last_heartbeat_at, heartbeatAgeSeconds: heartbeatAge },
      queue: { dueJobs: Number(row.due_jobs), oldestDueJobAgeSeconds: queueLag, permanentlyFailedJobs: Number(row.failed_jobs) },
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? "dev",
    };
    return Response.json(body, { status: workerOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "down", database: { ok: false } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
