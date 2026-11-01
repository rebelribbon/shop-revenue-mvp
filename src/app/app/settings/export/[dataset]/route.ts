import { sessionNeedsMfa } from "@/server/auth/assurance";
import { z } from "zod";
import { getSessionState } from "@/server/auth/session";
import { withTenant } from "@/db/tenant";
import {
  authorizeExport,
  exportDatasets,
  exportStream,
} from "@/domain/data-export";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dataset: string }> },
) {
  const state = await getSessionState();
  if (
    state.kind !== "shop" ||
    state.session.role !== "owner" ||
    state.session.actor.type !== "user"
  )
    return Response.json({ error: "Owner access required" }, { status: 403 });
  if (await sessionNeedsMfa(state.session.role))
    return Response.json(
      { error: "Verify your authenticator first" },
      { status: 403 },
    );
  const parsed = z.enum(exportDatasets).safeParse((await params).dataset);
  if (!parsed.success)
    return Response.json({ error: "Unknown export" }, { status: 404 });
  const { businessId, actor } = state.session;
  await withTenant(businessId, actor, (tx) =>
    authorizeExport(tx, { requestId: crypto.randomUUID() }, parsed.data),
  );
  const date = new Date();
  return new Response(exportStream(businessId, actor, parsed.data, date), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="shop-revenue-${parsed.data}-${date.toISOString().slice(0, 10)}.ndjson"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
