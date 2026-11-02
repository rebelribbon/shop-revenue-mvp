// Opens a photo/video. Shop users see their own business's files; customers
// see only files included on the estimate or invoice link they hold.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { runInContext, withTenant } from "@/db/tenant";
import { shopMediaKey } from "@/domain/job-media";
import { createReadUrl } from "@/lib/media-storage";
import { hashToken, isWellFormedToken } from "@/lib/tokens";
import { getSessionState } from "@/server/auth/session";

export const dynamic = "force-dynamic";
const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  if (!z.uuid().safeParse(fileId).success) return notFound();
  const token = new URL(req.url).searchParams.get("t");
  let key: string | null = null;
  if (token) {
    if (!isWellFormedToken(token)) return notFound();
    key = await runInContext(
      null,
      { type: "customer", id: null },
      async (tx) => {
        const r = await tx.execute(
          sql`select app.public_media_key(${hashToken(token)}, ${fileId}::uuid) as key`,
        );
        return (r.rows[0]?.key as string | null) ?? null;
      },
    );
  } else {
    const state = await getSessionState();
    if (state.kind !== "shop") return notFound();
    key = await withTenant(
      state.session.businessId,
      state.session.actor,
      (tx) => shopMediaKey(tx, fileId),
    );
  }
  if (!key) return notFound();
  const url = await createReadUrl(key, 300);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
