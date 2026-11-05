// Server action contract (Section 10) and the identity part of the Section 9
// cross-tenant matrix, through the real action wrapper and real database. Only
// the Next.js request boundary (session + headers) is replaced.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditEvent, membership, requestIdempotency } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob } from "@/domain/jobs";
import { assignJob } from "@/domain/assignments";
import { startClockAction, stopClockAction } from "@/server/actions/job-profit";
import { recordInvoicePaymentAction } from "@/server/actions/invoices";
import { inviteStaff, acceptInvite } from "@/domain/membership";
import {
  MemoryEmailProvider,
  setEmailProviderForTests,
} from "@/providers/email";
import type { SessionState, ShopSession } from "@/server/auth/session";
import {
  createInternalUser,
  meta,
  seedTenant,
  type SeededTenant,
} from "../helpers/fixtures";

let current: SessionState = { kind: "anonymous" };
vi.mock("@/server/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/server/auth/session")>()),
  getSessionState: async () => current,
}));
vi.mock("@/server/request", () => ({
  getRequestMeta: async () => ({
    requestId: `req-${randomUUID()}`,
    ip: "203.0.113.9",
  }),
}));

const { inviteStaffAction, removeStaffAction, resendInviteAction } =
  await import("@/server/actions/team");

let A: SeededTenant;
let B: SeededTenant;
const email = new MemoryEmailProvider();
const identity = {
  authSubject: randomUUID(),
  email: null,
  phoneE164: null,
  provider: "email",
};
const as = (session: ShopSession): SessionState => ({
  kind: "shop",
  identity,
  session,
});
const owner = (t: SeededTenant): ShopSession => ({
  businessId: t.businessId,
  actor: t.owner.actor,
  role: "owner",
  userId: t.owner.userId,
  supportSession: null,
});
const staff = (t: SeededTenant): ShopSession => ({
  businessId: t.businessId,
  actor: t.staff!.actor,
  role: "staff",
  userId: t.staff!.userId,
  supportSession: null,
});

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
    const r = await inviteStaffAction({
      name: "X",
      email: "x@example.test",
      clientRequestId: randomUUID(),
    });
    expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("rejects unknown fields and a missing clientRequestId", async () => {
    current = as(owner(B));
    expect(
      await inviteStaffAction({
        name: "X",
        email: "x@example.test",
        businessId: A.businessId,
        clientRequestId: randomUUID(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(
      await inviteStaffAction({ name: "X", email: "x@example.test" }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("Staff calling an Owner-only action is forbidden server-side", async () => {
    current = as(staff(A));
    const r = await inviteStaffAction({
      name: "X",
      email: "x2@example.test",
      clientRequestId: randomUUID(),
    });
    expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((r as { error: { referenceId: string } }).error.referenceId).toMatch(
      /^req-/,
    );
  });

  it("is idempotent per clientRequestId: one membership, one email, and no token stored", async () => {
    current = as(owner(B));
    const clientRequestId = randomUUID();
    const before = email.sent.length;
    const input = {
      name: "Mo",
      email: `mo-${randomUUID()}@example.test`,
      clientRequestId,
    };
    const first = await inviteStaffAction(input);
    const second = await inviteStaffAction(input);
    expect(first).toMatchObject({
      ok: true,
      data: { status: "sent", message: "Invite sent by email." },
    });
    expect(second).toMatchObject({
      ok: true,
      data: { message: "Invite already sent for this request." },
    });
    expect(email.sent.length - before).toBe(1);
    const [stored] = await withTenant(B.businessId, B.owner.actor, (tx) =>
      tx
        .select()
        .from(requestIdempotency)
        .where(eq(requestIdempotency.clientRequestId, clientRequestId)),
    );
    const token = email.sent
      .at(-1)!
      .text.match(/invite\/([A-Za-z0-9_-]{43})/)![1];
    expect(JSON.stringify(stored.responseJson)).not.toContain(token);
    const seats = await withTenant(B.businessId, B.owner.actor, (tx) =>
      tx
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.businessId, B.businessId),
            eq(membership.role, "staff"),
          ),
        ),
    );
    expect(seats).toHaveLength(1);
  });

  it("support view-as cannot mutate: forbidden and audited with the session id", async () => {
    const agent = await createInternalUser("support");
    const { startSupportSession } = await import("@/domain/support");
    const s = await startSupportSession({ internalUserId: agent.id }, meta(), {
      businessId: A.businessId,
      reason: "Checking team page for owner",
    });
    current = as({
      businessId: A.businessId,
      actor: { type: "support", id: agent.id, supportSessionId: s.id },
      role: "support",
      userId: null,
      supportSession: {
        id: s.id,
        expiresAt: s.expiresAt,
        businessName: "Kilo Auto",
      },
    });
    const r = await removeStaffAction({
      membershipId: randomUUID(),
      clientRequestId: randomUUID(),
    });
    expect(r).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", message: "View-as is read-only." },
    });
    const audits = await withTenant(A.businessId, A.owner.actor, (tx) =>
      tx
        .select()
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.action, "support.mutation_blocked"),
            eq(auditEvent.supportSessionId, s.id),
          ),
        ),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: "support",
      actorId: agent.id,
      after: { action: "removeStaff" },
    });
  });
});

describe("cross-tenant matrix (identity parts, Section 9)", () => {
  it("Owner of A acting on B's membership IDs gets not-found and nothing changes", async () => {
    const bMembershipId: string = await withTenant(
      B.businessId,
      B.owner.actor,
      async (tx) => {
        const [m] = await tx
          .select()
          .from(membership)
          .where(
            and(
              eq(membership.businessId, B.businessId),
              eq(membership.role, "staff"),
            ),
          );
        return m
          ? m.id
          : (
              await inviteStaff(tx, meta(), {
                name: "Bee",
                email: `bee-${randomUUID()}@example.test`,
              })
            ).membershipId;
      },
    );
    current = as(owner(A));
    for (const act of [removeStaffAction, resendInviteAction]) {
      const r = await act({
        membershipId: bMembershipId,
        clientRequestId: randomUUID(),
      });
      expect(r).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      expect(JSON.stringify(r)).not.toContain(B.businessId);
    }
    const [still] = await withTenant(B.businessId, B.owner.actor, (tx) =>
      tx.select().from(membership).where(eq(membership.id, bMembershipId)),
    );
    expect(still.status).not.toBe("removed");
  });
});

it("enforces technician assignments on direct actions and idempotency replays", async () => {
  const t = await seedTenant("Tech actions");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const email = `tech-${randomUUID()}@example.test`;
  const invite = await run((tx) =>
    inviteStaff(tx, meta(), { name: "Tess", email, role: "technician" }),
  );
  const authSubject = randomUUID();
  const joined = await acceptInvite(meta(), invite.token, {
    authSubject,
    email,
    phoneE164: null,
    displayName: "Tess",
  });
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Tech", lastName: "Actions" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const j = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Assigned",
      parts: [],
      labor: [],
    }),
  );
  current = as({
    businessId: t.businessId,
    actor: { type: "user", id: joined.userId, authSubject },
    role: "technician",
    userId: joined.userId,
    supportSession: null,
  });
  expect(
    await startClockAction({ jobId: j.id, clientRequestId: randomUUID() }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  await run((tx) =>
    assignJob(tx, meta(), { jobId: j.id, userId: joined.userId }),
  );
  const request = { jobId: j.id, clientRequestId: randomUUID() };
  expect(await startClockAction(request)).toMatchObject({ ok: true });
  expect(await startClockAction(request)).toMatchObject({ ok: true });
  expect(
    await recordInvoicePaymentAction({
      invoiceId: randomUUID(),
      amountCents: 100,
      method: "cash",
      reference: "",
      clientRequestId: randomUUID(),
    }),
  ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  await run((tx) => assignJob(tx, meta(), { jobId: j.id, userId: null }));
  expect(await startClockAction(request)).toMatchObject({
    ok: false,
    error: { code: "NOT_FOUND" },
  });
  // A person can always stop their own running clock after reassignment.
  expect(
    await stopClockAction({ clientRequestId: randomUUID() }),
  ).toMatchObject({ ok: true });
});
