import { randomUUID } from "node:crypto";
import pg from "pg";
import { withAdmin } from "@/db/admin";
import { internalUser } from "@/db/schema";
import type { Actor } from "@/db/tenant";
import { createBusiness } from "@/domain/business";
import { acceptInvite, inviteStaff } from "@/domain/membership";
import type { RequestMeta } from "@/domain/records";
import { withTenant } from "@/db/tenant";

export const meta = (): RequestMeta => ({
  requestId: `test-${randomUUID()}`,
  ip: "127.0.0.1",
});

// A raw connection as one role, for attacks that bypass the data access layer.
export async function rawClient(
  role: "app" | "worker" | "admin" | "migration",
) {
  const url = {
    app: process.env.DATABASE_URL_APP,
    worker: process.env.DATABASE_URL_WORKER,
    admin: process.env.DATABASE_URL_ADMIN,
    migration: process.env.DATABASE_URL_MIGRATION,
  }[role];
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function createInternalUser(
  role: "admin" | "support",
  name = `Agent ${uniq()}`,
) {
  const [u] = await withAdmin(null, (tx) =>
    tx
      .insert(internalUser)
      .values({
        email: `${uniq()}@internal.example.test`,
        displayName: name,
        role,
      })
      .returning(),
  );
  return u;
}

export type SeededTenant = {
  businessId: string;
  owner: { userId: string; authSubject: string; email: string; actor: Actor };
  staff?: { userId: string; authSubject: string; email: string; actor: Actor };
};

export async function seedTenant(
  label: string,
  opts: { withStaff?: boolean } = {},
): Promise<SeededTenant> {
  const admin = await createInternalUser("admin");
  const ownerEmail = `owner-${uniq()}@shop.example.test`;
  const created = await createBusiness({ internalUserId: admin.id }, meta(), {
    legalName: `${label} Auto LLC`,
    dba: `${label} Auto`,
    owner: { name: `${label} Owner`, email: ownerEmail },
  });
  const ownerAuth = randomUUID();
  const owner = await acceptInvite(meta(), created.inviteToken, {
    authSubject: ownerAuth,
    email: ownerEmail,
    phoneE164: null,
    displayName: `${label} Owner`,
  });
  const ownerActor: Actor = {
    type: "user",
    id: owner.userId,
    authSubject: ownerAuth,
  };
  const tenant: SeededTenant = {
    businessId: created.businessId,
    owner: {
      userId: owner.userId,
      authSubject: ownerAuth,
      email: ownerEmail,
      actor: ownerActor,
    },
  };
  if (opts.withStaff) {
    const staffEmail = `staff-${uniq()}@shop.example.test`;
    const inv = await withTenant(created.businessId, ownerActor, (tx) =>
      inviteStaff(tx, meta(), { name: `${label} Staff`, email: staffEmail }),
    );
    const staffAuth = randomUUID();
    const staff = await acceptInvite(meta(), inv.token, {
      authSubject: staffAuth,
      email: staffEmail,
      phoneE164: null,
      displayName: `${label} Staff`,
    });
    tenant.staff = {
      userId: staff.userId,
      authSubject: staffAuth,
      email: staffEmail,
      actor: { type: "user", id: staff.userId, authSubject: staffAuth },
    };
  }
  return tenant;
}

// The pg client behind a drizzle transaction, for raw SQL attacks inside a tenant context.
export const clientOf = (tx: unknown) =>
  (tx as { session: { client: pg.PoolClient } }).session.client;
