import { and, eq } from "drizzle-orm";
import { withAdmin } from "../../src/db/admin";
import { legalPolicy, internalUser } from "../../src/db/schema";
import {
  createPolicyDraft,
  approvePolicy,
} from "../../src/domain/legal-policy";
export async function seedTestAuthorizationPolicy() {
  if (!["local", "test"].includes(process.env.APP_ENV ?? ""))
    throw new Error("Test policy is restricted to local/test environments");
  const [existing] = await withAdmin(null, (tx) =>
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
  if (existing) return existing;
  const admins = await withAdmin(null, (tx) =>
    tx
      .insert(internalUser)
      .values(
        ["drafter", "approver"].map((role) => ({
          email: `fixture-${role}-${crypto.randomUUID()}@example.test`,
          displayName: `TEST ONLY ${role}`,
          role: "admin",
        })),
      )
      .returning(),
  );
  const policy = await createPolicyDraft(
    { internalUserId: admins[0].id },
    { requestId: "test-policy" },
    {
      jurisdictionCode: "US-TX",
      kind: "estimate_authorization",
      body: "I have reviewed this estimate and explicitly approved or declined every item. I authorize only approved items at the displayed prices. My name and drawn signature record my decision. TEST ONLY — not attorney-approved production wording.",
    },
  );
  return approvePolicy(
    { internalUserId: admins[1].id },
    { requestId: "test-policy" },
    {
      policyId: policy.id,
      approvalReference: "TEST FIXTURE ONLY; NOT LEGAL APPROVAL",
    },
  );
}
