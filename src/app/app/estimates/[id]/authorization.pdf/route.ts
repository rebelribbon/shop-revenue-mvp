import { and, eq } from "drizzle-orm";
import { estimateAuthorization } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";
import { z } from "zod";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await requireShopSession("/app/estimates");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 });
  const [row] = await withTenant(s.businessId, s.actor, (tx) =>
    tx
      .select({ pdf: estimateAuthorization.evidencePdfBase64 })
      .from(estimateAuthorization)
      .where(
        and(
          eq(estimateAuthorization.businessId, tx.businessId),
          eq(estimateAuthorization.versionId, id),
        ),
      ),
  );
  if (!row?.pdf)
    return new Response("No archived PDF exists for this authorization.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  return new Response(new Uint8Array(Buffer.from(row.pdf, "base64")), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=authorization.pdf",
      "Cache-Control": "private, no-store",
    },
  });
}
