import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { shopDocumentPdf } from "@/domain/documents";
import { getSessionState } from "@/server/auth/session";
import { sessionNeedsMfa } from "@/server/auth/assurance";
export const dynamic = "force-dynamic";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const state = await getSessionState();
  if (state.kind !== "shop" || !z.uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 });
  if (await sessionNeedsMfa())
    return Response.json(
      { error: "Verify your authenticator first" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  const doc = await withTenant(
    state.session.businessId,
    state.session.actor,
    (tx) => shopDocumentPdf(tx, id),
  );
  if (!doc) return new Response("Not found", { status: 404 });
  const name = doc.title.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "document";
  return new Response(new Uint8Array(doc.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name} - signed.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
