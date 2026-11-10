import { withTenant } from "@/db/tenant";
import { listMyJobHandoffs } from "@/domain/job-handoffs";
import { sessionNeedsMfa } from "@/server/auth/assurance";
import { getSessionState } from "@/server/auth/session";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const state = await getSessionState();
  if (state.kind !== "shop" || state.session.actor.type !== "user")
    return Response.json(
      { error: "Sign in to view assignments." },
      { status: 401, headers },
    );
  if (await sessionNeedsMfa())
    return Response.json(
      { error: "Verify your authenticator first." },
      { status: 403, headers },
    );
  try {
    const tasks = await withTenant(
      state.session.businessId,
      state.session.actor,
      async (tx) =>
        (await listMyJobHandoffs(tx)).map((handoff) => ({
          id: `${handoff.jobId}:${handoff.stage}:${handoff.occurredAt.toISOString()}`,
          jobId: handoff.jobId,
          title: handoff.title,
        })),
    );
    return Response.json({ tasks }, { headers });
  } catch {
    return Response.json(
      { error: "Assignments are temporarily unavailable." },
      { status: 503, headers },
    );
  }
}
