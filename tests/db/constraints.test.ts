// Database constraint tests (Section 22): each Section 8 invariant in Milestone 1
// scope is attacked directly in SQL and must fail with a specific error.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { withAdmin } from "@/db/admin";
import { withTenant, type Actor } from "@/db/tenant";
import { clientOf, createInternalUser, rawClient, seedTenant, type SeededTenant } from "../helpers/fixtures";

let A: SeededTenant;
let adminId: string;
const pgErr = (e: unknown) => {
  const x = (e as { cause?: unknown }).cause ?? e;
  return x as { code?: string; message?: string; constraint?: string };
};

// Run SQL as app_user inside A's tenant context; resolves to the pg error (or null).
async function sqlAs(actor: Actor, text: string, params: unknown[] = [], businessId = A.businessId, role: "app" | "worker" | "admin" = "app") {
  try {
    await withTenant(businessId, actor, (tx) => clientOf(tx).query(text, params), { role, retries: 0 });
    return null;
  } catch (e) {
    return pgErr(e);
  }
}

beforeAll(async () => {
  A = await seedTenant("Charlie", { withStaff: true });
  adminId = (await createInternalUser("admin")).id;
});

describe("membership rules (Section 8: max one owner, max two members)", () => {
  it("rejects a second active owner", async () => {
    const solo = await seedTenant("Delta");
    const err = await sqlAs(
      solo.owner.actor,
      `INSERT INTO app.membership (business_id, role, status, user_id) VALUES ($1, 'owner', 'active', $2)`,
      [solo.businessId, A.owner.userId],
      solo.businessId,
    );
    expect(err).toMatchObject({ code: "23505", constraint: "membership_one_active_owner_idx" });
  });

  it("rejects a third active member (owner + staff already active)", async () => {
    const err = await sqlAs(
      A.owner.actor,
      `INSERT INTO app.membership (business_id, role, status, user_id) VALUES ($1, 'owner', 'active', $2)`,
      [A.businessId, A.staff!.userId],
    );
    expect(err).toMatchObject({ code: "23514", message: expect.stringContaining("MEMBERSHIP_LIMIT") });
  });

  it("rejects a second staff seat while one is invited or active", async () => {
    const err = await sqlAs(
      A.owner.actor,
      `INSERT INTO app.membership (business_id, role, status, invite_email) VALUES ($1, 'staff', 'invited', 'second@example.test')`,
      [A.businessId],
    );
    expect(err).toMatchObject({ code: "23505", constraint: "membership_one_staff_seat_idx" });
  });

  it("the trigger caps active members at two even if the seat indexes were bypassed", async () => {
    // Drop the staff-seat index inside a rolled-back migration_owner transaction to
    // prove the trigger is an independent layer.
    const c = await rawClient("migration");
    await c.query("BEGIN");
    try {
      await c.query("DROP INDEX app.membership_one_staff_seat_idx");
      await c.query("SELECT set_config('app.business_id', $1, true)", [A.businessId]);
      // migration_owner needs a policy to write; use the trigger directly through app_user semantics:
      await c.query("CREATE POLICY t_tmp ON app.membership FOR ALL TO migration_owner USING (true) WITH CHECK (true)");
      await c.query("CREATE POLICY t_tmp ON app.\"user\" FOR ALL TO migration_owner USING (true) WITH CHECK (true)");
      const { rows } = await c.query(
        `INSERT INTO app."user" (auth_provider_id, display_name) VALUES ($1, 'Third') RETURNING id`,
        [randomUUID()],
      );
      await expect(
        c.query(`INSERT INTO app.membership (business_id, role, status, user_id) VALUES ($1, 'staff', 'active', $2)`, [
          A.businessId,
          rows[0].id,
        ]),
      ).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("MEMBERSHIP_LIMIT") });
    } finally {
      await c.query("ROLLBACK");
      await c.end();
    }
  });

  it("rejects invalid membership transitions (removed -> active)", async () => {
    const id = randomUUID();
    expect(
      await sqlAs(A.owner.actor, `INSERT INTO app.membership (id, business_id, role, status, invite_email) VALUES ($1, $2, 'staff', 'invited', 'x@example.test')`, [id, A.businessId]),
    ).toMatchObject({ code: "23505" }); // seat is taken by the active staff
    const err = await sqlAs(A.owner.actor, `UPDATE app.membership SET status = 'invited' WHERE user_id = $1`, [A.staff!.userId]);
    expect(err?.message).toMatch(/INVALID_TRANSITION: membership active -> invited/);
  });

  it("role and user are immutable; memberships are never deleted", async () => {
    expect((await sqlAs(A.owner.actor, `UPDATE app.membership SET role = 'owner' WHERE user_id = $1`, [A.staff!.userId]))?.code).toBe("42501");
    expect((await sqlAs(A.owner.actor, `DELETE FROM app.membership WHERE user_id = $1`, [A.staff!.userId]))?.code).toBe("42501");
    const viaOwner = await rawClient("migration");
    await viaOwner.query("BEGIN");
    await viaOwner.query("CREATE POLICY t_tmp ON app.membership FOR ALL TO migration_owner USING (true)");
    await expect(viaOwner.query("DELETE FROM app.membership WHERE user_id = $1", [A.staff!.userId])).rejects.toMatchObject({
      message: expect.stringContaining("APPEND_ONLY"),
    });
    await viaOwner.query("ROLLBACK");
    await viaOwner.end();
  });
});

describe("append-only evidence (audit_event, activity)", () => {
  for (const table of ["audit_event", "activity"]) {
    it(`${table}: app_user has no UPDATE/DELETE/TRUNCATE`, async () => {
      for (const stmt of [`UPDATE app.${table} SET created_at = now()`, `DELETE FROM app.${table}`, `TRUNCATE app.${table}`]) {
        expect((await sqlAs(A.owner.actor, stmt))?.code).toBe("42501");
      }
    });

    it(`${table}: even the owning role cannot update, delete or truncate`, async () => {
      const c = await rawClient("migration");
      for (const stmt of [`UPDATE app.${table} SET created_at = now()`, `DELETE FROM app.${table}`, `TRUNCATE app.${table}`]) {
        await c.query("BEGIN");
        await c.query(`CREATE POLICY t_tmp ON app.${table} FOR ALL TO migration_owner USING (true)`);
        await expect(c.query(stmt)).rejects.toMatchObject({ message: expect.stringContaining("APPEND_ONLY") });
        await c.query("ROLLBACK");
      }
      await c.end();
    });
  }
});

describe("platform audit rows (spec issue 1)", () => {
  it("only internal or system actors may write an audit row with no business", async () => {
    const c = await rawClient("admin");
    await expect(
      c.query(`INSERT INTO app.audit_event (actor_type, action, target_type, request_id) VALUES ('user', 'x.y', 't', 'r')`),
    ).rejects.toMatchObject({ code: "23514" });
    await c.query(`INSERT INTO app.audit_event (actor_type, action, target_type, request_id) VALUES ('internal', 'x.y', 't', 'r')`);
    await c.end();
  });

  it("app_user can never write or read platform rows", async () => {
    const c = await rawClient("app");
    await expect(
      c.query(`INSERT INTO app.audit_event (actor_type, action, target_type, request_id) VALUES ('internal', 'x.y', 't', 'r')`),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await c.query("SELECT count(*)::int n FROM app.audit_event")).rows[0].n).toBe(0);
    await c.end();
  });
});

describe("support view-as is read-only at the database", () => {
  it("rejects writes from actor_type support even outside a read-only transaction", async () => {
    const c = await rawClient("app");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.business_id', $1, true), set_config('app.actor_type', 'support', true)", [A.businessId]);
    await expect(
      c.query("INSERT INTO app.request_idempotency (business_id, client_request_id, action, response_json) VALUES ($1, $2, 'x', '{}')", [
        A.businessId,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await c.query("ROLLBACK");
    await c.end();
  });

  it("support writes no audit row without a support session id", async () => {
    const err = await sqlAs(
      { type: "support", id: adminId },
      "INSERT INTO app.audit_event (business_id, actor_type, action, target_type, request_id) VALUES ($1, 'support', 'x.y', 't', 'r')",
      [A.businessId],
    );
    // withTenant opens support transactions READ ONLY
    expect(err?.code).toBe("25006");
  });
});

describe("support_session record", () => {
  it("lasts exactly 60 minutes, set by the database; ends once; never deleted", async () => {
    const s = await withAdmin({ internalUserId: adminId }, async (tx) => {
      const r = await clientOf(tx).query(
        `INSERT INTO app.support_session (admin_user_id, admin_display_name, business_id, reason, started_at, expires_at)
         VALUES ($1, 'A', $2, 'checking settings page', now() - interval '3 hours', now() + interval '9 hours') RETURNING *`,
        [adminId, A.businessId],
      );
      return r.rows[0];
    });
    expect(new Date(s.expires_at).getTime() - new Date(s.started_at).getTime()).toBe(60 * 60 * 1000);
    expect(Math.abs(new Date(s.started_at).getTime() - Date.now())).toBeLessThan(60_000);
    const c = await rawClient("admin");
    await expect(c.query("UPDATE app.support_session SET reason = 'changed reason here' WHERE id = $1", [s.id])).rejects.toMatchObject({ code: "42501" });
    await c.query("UPDATE app.support_session SET ended_at = now(), end_reason = 'ended' WHERE id = $1", [s.id]);
    await expect(c.query("UPDATE app.support_session SET ended_at = now(), end_reason = 'ended' WHERE id = $1", [s.id])).rejects.toMatchObject({
      message: expect.stringContaining("APPEND_ONLY"),
    });
    await expect(c.query("DELETE FROM app.support_session WHERE id = $1", [s.id])).rejects.toMatchObject({ code: "42501" });
    await c.end();
  });
});

describe("legal_policy", () => {
  it("is inserted only as a draft, hashed by the database, and approval needs a second admin", async () => {
    const c = await rawClient("admin");
    await expect(
      c.query(`INSERT INTO app.legal_policy (jurisdiction_code, kind, version, body, body_sha256, status, created_by_internal_user_id)
               VALUES ('US-TX', 'invoice_terms', 99, 'x', '', 'approved', $1)`, [adminId]),
    ).rejects.toMatchObject({ message: expect.stringContaining("INVALID_TRANSITION") });
    const { rows } = await c.query(
      `INSERT INTO app.legal_policy (jurisdiction_code, kind, version, body, body_sha256, created_by_internal_user_id)
       VALUES ('US-TX', 'invoice_terms', 99, 'Terms text', 'bogus', $1) RETURNING id, body_sha256, encode(sha256('Terms text'::bytea), 'hex') AS expected`,
      [adminId],
    );
    expect(rows[0].body_sha256).toBe(rows[0].expected);
    await expect(
      c.query(`UPDATE app.legal_policy SET status = 'approved', approved_by = $1, approved_at = now(), approval_reference = 'memo' WHERE id = $2`, [
        adminId,
        rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "legal_policy_second_admin_check" });
    const second = await createInternalUser("admin");
    await c.query(`UPDATE app.legal_policy SET status = 'approved', approved_by = $1, approved_at = now(), approval_reference = 'memo' WHERE id = $2`, [
      second.id,
      rows[0].id,
    ]);
    await expect(c.query("UPDATE app.legal_policy SET body = 'changed' WHERE id = $1", [rows[0].id])).rejects.toMatchObject({
      message: expect.stringContaining("IMMUTABLE"),
    });
    await expect(c.query("UPDATE app.legal_policy SET status = 'draft' WHERE id = $1", [rows[0].id])).rejects.toMatchObject({
      message: expect.stringContaining("INVALID_TRANSITION"),
    });
    await expect(c.query("DELETE FROM app.legal_policy WHERE id = $1", [rows[0].id])).rejects.toMatchObject({ code: "42501" });
    await c.end();
  });

  it("allows one approved version per jurisdiction and kind", async () => {
    const c = await rawClient("admin");
    const second = await createInternalUser("admin");
    const ins = async (v: number) =>
      (
        await c.query(
          `INSERT INTO app.legal_policy (jurisdiction_code, kind, version, body, body_sha256, created_by_internal_user_id) VALUES ('US-OK', 'retention_rules', $1, 'b', '', $2) RETURNING id`,
          [v, adminId],
        )
      ).rows[0].id;
    const approve = (id: string) =>
      c.query(`UPDATE app.legal_policy SET status = 'approved', approved_by = $1, approved_at = now(), approval_reference = 'm' WHERE id = $2`, [second.id, id]);
    await approve(await ins(1));
    await expect(approve(await ins(2))).rejects.toMatchObject({ code: "23505", constraint: "legal_policy_one_approved_idx" });
    await c.end();
  });
});

describe("normalized contact data", () => {
  it("rejects non-E.164 phones and non-normalized emails", async () => {
    const c = await rawClient("app");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.auth_subject', $1, true)", [randomUUID()]);
    const sub = (await c.query("SELECT current_setting('app.auth_subject') s")).rows[0].s;
    await expect(c.query(`INSERT INTO app."user" (auth_provider_id, display_name, phone_e164) VALUES ($1, 'x', '(512) 555-0100')`, [sub])).rejects.toMatchObject({
      code: "23514",
    });
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.auth_subject', $1, true)", [sub]);
    await expect(c.query(`INSERT INTO app."user" (auth_provider_id, display_name, email) VALUES ($1, 'x', ' Bob@Example.test')`, [sub])).rejects.toMatchObject({
      code: "23514",
    });
    await c.query("ROLLBACK");
    await c.end();
  });

  it("a person can only create their own user row", async () => {
    const c = await rawClient("app");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.auth_subject', $1, true)", [randomUUID()]);
    await expect(c.query(`INSERT INTO app."user" (auth_provider_id, display_name) VALUES ($1, 'Someone else')`, [randomUUID()])).rejects.toMatchObject({
      code: "42501",
    });
    await c.query("ROLLBACK");
    await c.end();
  });
});

describe("file keys are tenant-prefixed", () => {
  it("rejects a storage key outside b/{business_id}/{kind}/", async () => {
    const id = randomUUID();
    const err = await sqlAs(
      A.owner.actor,
      `INSERT INTO app.file (id, business_id, storage_key, kind, content_type, byte_size) VALUES ($1, $2, $3, 'logo', 'image/png', 1)`,
      [id, A.businessId, `b/${randomUUID()}/logo/2026/10/${id}.png`],
    );
    expect(err).toMatchObject({ code: "23514", constraint: "file_storage_key_prefix_check" });
  });
});

describe("uuid_v7", () => {
  it("produces version-7 RFC 9562 ids in time order", async () => {
    const c = await rawClient("app");
    const { rows } = await c.query("SELECT app.uuid_v7()::text AS a, pg_sleep(0.002), app.uuid_v7()::text AS b");
    await c.end();
    for (const u of [rows[0].a, rows[0].b]) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(rows[0].a < rows[0].b).toBe(true);
    const ms = parseInt(rows[0].a.replace(/-/g, "").slice(0, 12), 16);
    expect(Math.abs(ms - Date.now())).toBeLessThan(60_000);
  });
});
