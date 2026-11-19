import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobMedia } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { assignedAdvisorForJob } from "@/domain/job-handoffs";
import { shopMediaKey } from "@/domain/job-media";
import { canManageTeam, currentMemberRole } from "@/domain/membership";
import { createReadUrl } from "@/lib/media-storage";
import { getSessionState } from "@/server/auth/session";

export const dynamic = "force-dynamic";

// Signed file links never appear in stored HTML. Every image/video read
// rechecks its tenant and the viewer's current RO assignment.
export async function GET(request: Request) {
  const fileId = new URL(request.url).searchParams.get("fileId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(fileId))
    return new Response("Invalid file.", { status: 400 });
  const state = await getSessionState();
  if (state.kind !== "shop" || state.session.actor.type !== "user")
    return new Response("Sign in required.", { status: 401 });

  const actorId = state.session.actor.id;
  const key = await withTenant(
    state.session.businessId,
    state.session.actor,
    async (tx) => {
      const [row] = await tx
        .select({ jobId: jobMedia.jobId })
        .from(jobMedia)
        .where(
          and(
            eq(jobMedia.businessId, tx.businessId),
            eq(jobMedia.fileId, fileId),
            isNull(jobMedia.deletedAt),
          ),
        )
        .limit(1);
      if (!row?.jobId) return null;
      const manager = await canManageTeam(tx);
      const role = await currentMemberRole(tx);
      if (
        !manager &&
        role === "staff" &&
        (await assignedAdvisorForJob(tx, row.jobId)) !== actorId
      )
        return null;
      // shopMediaKey independently verifies the assigned technician.
      return shopMediaKey(tx, fileId);
    },
  );
  if (!key) return new Response("File not found.", { status: 404 });
  try {
    return NextResponse.redirect(await createReadUrl(key, 180), {
      status: 302,
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return new Response("Unable to open file.", { status: 503 });
  }
}
