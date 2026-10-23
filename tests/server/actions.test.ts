// Server action contract (Section 10) and the identity part of the Section 9
// cross-tenant matrix, through the real action wrapper and real database. Only
// the Next.js request boundary (session + headers) is replaced.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditEvent, membership, requestIdempotency } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { inviteStaff } from "@/domain/membership";
import { MemoryEmailProvider, setEmailProviderForTests } from "@/providers/email";
import type { SessionState, ShopSession } from "@/server/auth/session";
import { createInternalUser, meta, seedTenant, type SeededTenant } from "../helpers/fixtures";

let current: SessionState = { kind: "anonymous" };
vi.mock("@/server/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/server/auth/session")>()),
  getSessionState: async () => current,
}));
vi.mock("@/server/request", () => ({ getRequestMeta: async () => ({ requestId: `req-${randomUUID()}`, ip: "203.0.113.9" }) }));

const { inviteStaffAction, removeStaffAction, resendInviteAction } = await import("@/server/actions/team");

let A: SeededTenant;
let B: SeededTenant;
const email = new MemoryEmailProvider();
const identity = { authSubject: randomUUID(), email: null, phoneE164: null, provider: "email" };
const as = (session: ShopSession): SessionState => ({ kind: "shop", identity, session });
const owner = (t: SeededTenant): ShopSession => ({ businessId: t.businessId, actor: t.owner.actor, role: "owner", userId: t.owner.userId, supportSession: null });
const staff = (t: SeededTenant): ShopSession => ({ businessId: t.businessId, actor: t.staff!.actor, role: "staff", userId: t.staff!.userId, supportSession: null });

beforeAll(async () => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.EMAIL_FROM_ADDRESS = "test@example.test";
  setEmailProviderForTests(email);
  A = await seedTenant("Kilo", { withStaff: true });
  B = await seedTenant("Lima");
});
beforeEach(() => {
  current = { kind: "anonymous" };
});

describe("action contract", () => {
  it("rejects anonymous callers", async () => {
    const r = await inviteStaffAction({ name: "X", email: "x@example.test", clientRequestId: randomUUID() });
    expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("rejects unknown fields and a missing clientRequestId", async () => {
    current = as(owner(B));
    expect(await inviteStaffAction({ name: "X", email: "x@example.test", businessId: A.businessId, clientRequestId: randomUUID() })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(await inviteStaffAction({ name: "X", email: "x@example.test" })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("Staff calling an Owner-only action is forbidden server-side", async () => {
    current = as(staff(A));
    const r = await inviteStaffAction({ name: "X", email: "x2@example.test", clientRequestId: randomUUID() });
    expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((r as { error: { referenceId: string } }).error.referenceId).toMatch(/^req-/);
  });

  it("is idempotent per clientRequestId: one membership, one email, and no token stored", async () => {
    current = as(owner(B));
    const clientRequestId = randomUUID();
    const before = email.sent.length;
    const input = { name: "Mo", email: `mo-${randomUUID()}@example.test`, clientRequestId };
    const first = await inviteStaffAction(input);
    const second = await inviteStaffAction(input);
    expect(first).toMatchObject({ ok: true, data: { status: "sent", message: "Invite sent by email." } });
    expect(second).toMatchObject({ ok: true, data: { message: "Invite already sent for this request." } });
    expect(email.sent.length - before).toBe(1);
    const [stored] = await withTenant(B.businessId, B.owner.actor, (tx) =>
      tx.select().from(requestIdempotency).where(eq(requestIdempotency.clientRequestId, clientRequestId)),
    );
    const token = email.sent.at(-1)!.text.match(/invite\/([A-Za-z0-9_-]{43})/)![1];
    expect(JSON.stringify(stored.responseJson)).not.toContain(token);
    const seats = await withTenant(B.businessId, B.owner.actor, (tx) =>
      tx.select().from(membership).where(and(eq(membership.businessId, B.businessId), eq(membership.role, "staff"))),
    );
    expect(seats).toHaveLength(1);
  });

  it("support view-as cannot mutate: forbidden and audited with the session id", async () => {
    const agent = await createInternalUser("support");
    const { startSupportSession } = await import("@/domain/support");
    const s = await startSupportSession({ internalUserId: agent.id }, meta(), { businessId: A.businessId, reason: "Checking team page for owner" });
    current = as({
      businessId: A.businessId,
      actor: { type: "support", id: agent.id, supportSessionId: s.id },
      role: "support",
      userId: null,
      supportSession: { id: s.id, expiresAt: s.expiresAt, businessName: "Kilo Auto" },
    });
    const r = await removeStaffAction({ membershipId: randomUUID(), clientRequestId: randomUUID() });
    expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN", message: "View-as is read-only." } });
    const audits = await withTenant(A.businessId, A.owner.actor, (tx) =>
      tx.select().from(auditEvent).where(and(eq(auditEvent.action, "support.mutation_blocked"), eq(auditEvent.supportSessionId, s.id))),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "support", actorId: agent.id, after: { action: "removeStaff" } });
  });
});

describe("cross-tenant matrix (identity parts, Section 9)", () => {
  it("Owner of A acting on B's membership IDs gets not-found and nothing changes", async () => {
    const bInvite = await withTenant(B.businessId, B.owner.actor, async (tx) => {
      const [m] = await tx.select().from(membership).where(and(eq(membership.businessId, B.businessId), eq(membership.role, "staff")));
      return m ?? (await inviteStaff(tx, meta(), { name: "Bee", email: `bee-${randomUUID()}@example.test` }));
    });
    const bMembershipId = "membershipId" in bInvite ? bInvite.membershipId : bInvite.id;
    current = as(owner(A));
    for (const act of [removeStaffAction, resendInviteAction]) {
      const r = await act({ membershipId: bMembershipId, clientRequestId: randomUUID() });
      expect(r).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      expect(JSON.stringify(r)).not.toContain(B.businessId);
    }
    const [still] = await withTenant(B.businessId, B.owner.actor, (tx) => tx.select().from(membership).where(eq(membership.id, bMembershipId)));
    expect(still.status).not.toBe("removed");
  });
});
