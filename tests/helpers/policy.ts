import { and, eq } from "drizzle-orm";
import { withAdmin } from "@/db/admin";
import { legalPolicy } from "@/db/schema";
export async function testPolicySnapshot() {
  const [p] = await withAdmin(null, (tx) =>
    tx
      .select()
      .from(legalPolicy)
      .where(
        and(
          eq(legalPolicy.jurisdictionCode, "US-TX"),
          eq(legalPolicy.kind, "estimate_authorization"),
          eq(legalPolicy.status, "approved"),
        ),
      ),
  );
  return {
    id: p.id,
    version: p.version,
    jurisdictionCode: p.jurisdictionCode,
    body: p.body,
    bodySha256: p.bodySha256,
  };
}
