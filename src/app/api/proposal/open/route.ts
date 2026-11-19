import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { runInContext } from "@/db/tenant";
import { hashToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public token-scoped event. Never accepts a job/business ID from the browser.
// An invalid, revoked or expired token creates no event and reveals no details.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = z
    .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .safeParse(body);
  if (parsed.success) {
    try {
      await runInContext(null, { type: "customer", id: null }, async (tx) => {
        await tx.execute(
          sql`select app.record_estimate_open(${hashToken(parsed.data.token)})`,
        );
      });
    } catch {
      // Analytics must never prevent the customer from viewing or signing.
    }
  }
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
