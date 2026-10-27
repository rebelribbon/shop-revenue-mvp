// RLS suite (Section 22): generated for every table with a business_id column,
// discovered from the catalog. Insert in A; B sees nothing, changes nothing and
// cannot write into A; a raw query without tenant context sees nothing.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { withAdmin } from "@/db/admin";
import { assetReading, note, appointment, customer, file, location, membership, requestIdempotency, supportSession, vehicle } from "@/db/schema";
import { ingestWebhookEvent, withTenant, type Actor } from "@/db/tenant";
import { audit, recordActivity } from "@/domain/records";
import { eq, sql } from "drizzle-orm";
import { findRlsViolations, findTenantFkViolations } from "../../scripts/db/check-rls";
import { clientOf, createInternalUser, meta, rawClient, seedTenant, type SeededTenant } from "../helpers/fixtures";

let A: SeededTenant;
let B: SeededTenant;
let adminId: string;

beforeAll(async () => {
  A = await seedTenant("Alpha");
  B = await seedTenant("Bravo");
  adminId = (await createInternalUser("admin")).id;
});

type Builder = (t: SeededTenant) => Promise<string>;
const builders: Record<string, Builder> = {
  "app.asset": async t => builders["app.vehicle"](t),
  "app.asset_reading": async t => {
    const id=await builders["app.vehicle"](t);
    return withTenant(t.businessId,t.owner.actor,async tx => {
      const [r]=await tx.insert(assetReading).values({businessId:t.businessId,assetId:id,value:100}).returning(); return r.id;
    });
  },
  "app.note": async t => {
    const id=await builders["app.customer"](t);
    return withTenant(t.businessId,t.owner.actor,async tx => {
      const [r]=await tx.insert(note).values({businessId:t.businessId,customerId:id,body:"RLS note"}).returning(); return r.id;
    });
  },
  "app.location": async (t) =>
    (await withAdmin({ internalUserId: adminId }, async (tx) => {
      await tx.execute(sql`SELECT set_config('app.business_id', ${t.businessId}, true)`);
      const [r] = await tx.insert(location).values({ businessId: t.businessId, name: "Second bay" }).returning();
      return r;
    })).id,
  "app.membership": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [r] = await tx.insert(membership).values({ businessId: t.businessId, role: "staff", status: "invited", inviteEmail: `x${randomUUID()}@example.test` }).returning();
      await tx.update(membership).set({ status: "removed" }).where(eq(membership.id, r.id));
      return r.id;
    }),
  "app.customer": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [r] = await tx.insert(customer).values({ businessId: t.businessId, createdByUserId: t.owner.userId, firstName: "RLS", lastName: "Customer", displayName: `RLS Customer ${randomUUID()}` }).returning();
      return r.id;
    }),
  "app.vehicle": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [c] = await tx.insert(customer).values({ businessId: t.businessId, createdByUserId: t.owner.userId, firstName: "Vehicle", lastName: "Owner", displayName: `Vehicle Owner ${randomUUID()}` }).returning();
      const plate = `T${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
      const [r] = await tx.insert(vehicle).values({ businessId: t.businessId, createdByUserId: t.owner.userId, customerId: c.id, year: 2024, make: "BMW", model: "X5", plate, plateNormalized: plate }).returning();
      return r.id;
    }),
  "app.appointment": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [c] = await tx.insert(customer).values({ businessId: t.businessId, createdByUserId: t.owner.userId, firstName: "Appointment", lastName: "Customer", displayName: `Appointment Customer ${randomUUID()}` }).returning();
      const [r] = await tx.insert(appointment).values({ businessId: t.businessId, createdByUserId: t.owner.userId, customerId: c.id, startsAt: new Date(Date.now() + 86400000), reason: "RLS fixture" }).returning();
      return r.id;
    }),
  "app.activity": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const id = randomUUID();
      await recordActivity(tx, { kind: "test.created", subjectType: "test", subjectId: id, summary: "rls fixture" });
      return (await clientOf(tx).query("SELECT id FROM app.activity WHERE subject_id = $1", [id])).rows[0].id;
    }),
  "app.audit_event": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const id = randomUUID();
      await audit(tx, meta(), { action: "test.fixture", targetType: "test", targetId: id });
      return (await clientOf(tx).query("SELECT id FROM app.audit_event WHERE target_id = $1", [id])).rows[0].id;
    }),
  "app.request_idempotency": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [r] = await tx.insert(requestIdempotency).values({ businessId: t.businessId, clientRequestId: randomUUID(), action: "test", responseJson: { ok: true } }).returning();
      return r.id;
    }),
  "app.file": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const id = randomUUID();
      const [r] = await tx.insert(file).values({ id, businessId: t.businessId, storageKey: `b/${t.businessId}/logo/2026/10/${id}.png`, kind: "logo", contentType: "image/png", byteSize: 10 }).returning();
      return r.id;
    }),
  "app.support_session": async (t) =>
    (await withAdmin({ internalUserId: adminId }, async (tx) => {
      const [r] = await tx.insert(supportSession).values({ adminUserId: adminId, adminDisplayName: "Fixture", businessId: t.businessId, reason: "RLS fixture session", expiresAt: new Date() }).returning();
      return r;
    })).id,
  "app.webhook_event": async (t) => {
    const { eventId } = await ingestWebhookEvent({ provider: "stripe", providerEventId: `evt_${randomUUID()}`, eventType: "test.fixture", payload: { fixture: true } });
    const w = await rawClient("worker");
    await w.query("UPDATE app.webhook_event SET business_id = $1 WHERE id = $2", [t.businessId, eventId]);
    await w.end();
    return eventId;
  },
};

async function tenantTables(): Promise<string[]> {
  const c = await rawClient("migration");
  const { rows } = await c.query(`
    SELECT n.nspname || '.' || c.relname AS t
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = 'app'
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped)
     ORDER BY 1`);
  await c.end();
  return rows.map((r) => r.t);
}

const ROLES = ["app", "worker", "admin"] as const;
const GLOBAL_READERS: Record<string, string[]> = { "app.support_session": ["worker", "admin"], "app.webhook_event": ["worker", "admin"] };
const pgCode = (e: unknown) => (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
const roleOpt = (r: (typeof ROLES)[number]) => ({ role: r });
const actorFor = (r: (typeof ROLES)[number], t: SeededTenant): Actor => r === "app" ? t.owner.actor : r === "worker" ? { type: "system", id: null } : { type: "internal", id: adminId };

async function countAs(role: (typeof ROLES)[number], ctx: SeededTenant, table: string, where: string, params: unknown[]) {
  try {
    return await withTenant(ctx.businessId, actorFor(role, ctx), async (tx) => {
      const { rows } = await clientOf(tx).query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
      return rows[0].n as number;
    }, roleOpt(role));
  } catch (e) {
    if ((e as { code?: string }).code === "42501") return 0;
    throw e;
  }
}

describe("RLS presence check (CI rule)", () => {
  it("passes on the migrated schema", async () => {
    const c = await rawClient("migration");
    expect(await findRlsViolations(c)).toEqual([]);
    await c.end();
  });
  it("fails when a migration adds a tenant table without RLS", async () => {
    const c = await rawClient("migration");
    await c.query("BEGIN");
    try {
      await c.query("CREATE TABLE app.bad_tenant_table (id uuid PRIMARY KEY, business_id uuid NOT NULL)");
      await c.query("CREATE SCHEMA scratch_ci");
      await c.query("CREATE TABLE scratch_ci.bad_other_schema (id uuid PRIMARY KEY, business_id uuid NOT NULL)");
      await c.query("CREATE TABLE app.half_done (id uuid PRIMARY KEY, business_id uuid NOT NULL)");
      await c.query("ALTER TABLE app.half_done ENABLE ROW LEVEL SECURITY");
      await c.query("ALTER TABLE app.half_done FORCE ROW LEVEL SECURITY");
      expect(await findRlsViolations(c)).toEqual(expect.arrayContaining([
        { table: "app.bad_tenant_table", problems: ["RLS not enabled", "RLS not forced", "no permissive policy"] },
        { table: "scratch_ci.bad_other_schema", problems: ["RLS not enabled", "RLS not forced", "no permissive policy"] },
        { table: "app.half_done", problems: ["no permissive policy"] },
      ]));
    } finally { await c.query("ROLLBACK"); await c.end(); }
  });
});

describe("composite tenant foreign key check (CI rule)", () => {
  it("passes on the migrated schema", async () => {
    const c = await rawClient("migration");
    expect(await findTenantFkViolations(c)).toEqual([]);
    await c.end();
  });
  it("fails on a tenant-to-tenant reference that omits business_id", async () => {
    const c = await rawClient("migration");
    await c.query("BEGIN");
    try {
      await c.query(`CREATE TABLE app.loose_ref (id uuid PRIMARY KEY, business_id uuid NOT NULL, location_id uuid CONSTRAINT loose_ref_location_fk REFERENCES app.location (id))`);
      expect(await findTenantFkViolations(c)).toEqual([{ constraint: "loose_ref_location_fk", table: "app.loose_ref", references: "app.location" }]);
      await c.query(`ALTER TABLE app.loose_ref ADD CONSTRAINT loose_ref_location_tenant_fk FOREIGN KEY (business_id, location_id) REFERENCES app.location (business_id, id)`);
      expect(await findTenantFkViolations(c)).toEqual([]);
    } finally { await c.query("ROLLBACK"); await c.end(); }
  });
});

describe("generated tenant isolation for every business_id table", async () => {
  const tables = await tenantTables();
  it("has a fixture builder for every tenant table (add one when adding a table)", () => expect(tables.filter((t) => !builders[t])).toEqual([]));
  for (const table of tables) {
    describe(table, () => {
      let rowId: string;
      beforeAll(async () => { rowId = await builders[table](A); });
      it("owner tenant can see its own row", async () => {
        const visible = await Promise.all(ROLES.map((r) => countAs(r, A, table, "id = $1", [rowId])));
        expect(Math.max(...visible)).toBe(1);
      });
      for (const role of ROLES) {
        const globalReader = GLOBAL_READERS[table]?.includes(role);
        it(globalReader ? `${role}_user reads this global table across tenants by design (spec issue 2)` : `${role}_user in tenant B sees zero rows, even with WHERE business_id = A`, async () => {
          const expected = globalReader ? 1 : 0;
          expect(await countAs(role, B, table, "id = $1", [rowId])).toBe(expected);
          expect(await countAs(role, B, table, "business_id = $1 AND id = $2", [A.businessId, rowId])).toBe(expected);
        });
        it(`${role}_user in tenant B cannot update or delete A's row`, async () => {
          const r = await withTenant(B.businessId, actorFor(role, B), async (tx) => {
            const out: number[] = [];
            for (const stmt of [`UPDATE ${table} SET updated_at = updated_at WHERE id = $1`, `DELETE FROM ${table} WHERE id = $1`]) {
              await clientOf(tx).query("SAVEPOINT s");
              try { out.push((await clientOf(tx).query(stmt, [rowId])).rowCount ?? 0); await clientOf(tx).query("RELEASE SAVEPOINT s"); }
              catch { await clientOf(tx).query("ROLLBACK TO SAVEPOINT s"); out.push(0); }
            }
            return out;
          }, roleOpt(role));
          expect(r).toEqual([0, 0]);
          expect(await countAs("app", A, table, "id = $1", [rowId]) + await countAs("admin", A, table, "id = $1", [rowId]) + await countAs("worker", A, table, "id = $1", [rowId])).toBeGreaterThan(0);
        });
      }
      it("raw queries without tenant context return zero rows for every role", async () => {
        for (const role of ["app", "worker", "admin"] as const) {
          const c = await rawClient(role);
          try {
            const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE business_id IS NOT NULL`);
            if (GLOBAL_READERS[table]?.includes(role)) expect(rows[0].n).toBeGreaterThan(0); else expect(rows[0].n).toBe(0);
          } catch (e) { expect((e as { code?: string }).code).toBe("42501"); }
          finally { await c.end(); }
        }
      });
    });
  }
});

describe("cross-tenant writes are rejected", () => {
  it("app_user in B cannot insert a row claiming A's business_id", async () => {
    await expect(withTenant(B.businessId, B.owner.actor, (tx) => tx.insert(requestIdempotency).values({ businessId: A.businessId, clientRequestId: randomUUID(), action: "x", responseJson: {} }))).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
  });
  it("app_user in B cannot audit into A", async () => {
    await expect(withTenant(B.businessId, B.owner.actor, (tx) => clientOf(tx).query("INSERT INTO app.audit_event (business_id, actor_type, action, target_type, request_id) VALUES ($1, 'user', 'x.y', 't', 'r')", [A.businessId])).catch((e) => Promise.reject(pgCode(e)))).rejects.toBe("42501");
  });
  it("a business row is visible only to its own tenant", async () => {
    const c = await rawClient("app");
    expect((await c.query("SELECT count(*)::int n FROM app.business")).rows[0].n).toBe(0);
    await c.end();
    const seen = await withTenant(B.businessId, B.owner.actor, async (tx) => (await clientOf(tx).query("SELECT id FROM app.business")).rows.map((r) => r.id));
    expect(seen).toEqual([B.businessId]);
  });
  it("users of A are invisible from B", async () => {
    const seen = await withTenant(B.businessId, B.owner.actor, async (tx) => (await clientOf(tx).query('SELECT id FROM app."user"')).rows.map((r) => r.id));
    expect(seen).toEqual([B.owner.userId]);
  });
  it("webhook_event and internal_user are not readable by app_user at all", async () => {
    const c = await rawClient("app");
    for (const t of ["app.webhook_event", "app.internal_user"]) await expect(c.query(`SELECT 1 FROM ${t}`)).rejects.toMatchObject({ code: "42501" });
    await c.end();
  });
  it("a worker job for A carrying B's business_id is refused at enqueue", async () => {
    await expect(withTenant(A.businessId, { type: "system", id: null }, (tx) => clientOf(tx).query("SELECT app.enqueue_job('heartbeat', jsonb_build_object('business_id', $1::text))", [B.businessId]), { role: "worker" })).rejects.toThrow(/TENANT_MISMATCH/);
  });
  it("the shop reads only its own support sessions", async () => {
    const ids = await withTenant(B.businessId, B.owner.actor, async (tx) => (await clientOf(tx).query("SELECT business_id FROM app.support_session")).rows);
    expect(ids.every((r) => r.business_id === B.businessId)).toBe(true);
  });
});

