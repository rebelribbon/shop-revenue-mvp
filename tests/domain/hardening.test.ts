import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { safeNext } from "@/lib/safe-next";
import { maskTokenPath } from "@/lib/logger";
import { safeErrorDiagnostic } from "@/lib/errors";
import { mfaNeeded } from "@/lib/mfa-policy";
import {
  releaseConfiguration,
  stripeAccountReady,
  productionRecoveryReady,
} from "@/lib/release-readiness";
import { checkAuthThrottle } from "@/domain/auth-throttle";
import { runMaintenanceBatch, maintenanceStatus } from "@/domain/maintenance";
import { withGlobalWorker, withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import {
  authorizeExport,
  exportPage,
  exportStream,
  exportRecord,
} from "@/domain/data-export";
import { meta, seedTenant } from "../helpers/fixtures";
beforeAll(() => {
  process.env.SESSION_SIGNING_SECRET =
    "test-only-hardening-session-signing-secret";
});
describe("launch security boundaries", () => {
  it("requires fresh provider and independent backups for daily recovery, or verified PITR retention", () => {
    const now = Date.parse("2026-11-05T20:00:00Z");
    const fresh = "2026-11-05T07:00:00Z";
    expect(productionRecoveryReady(undefined, now)).toBe(false);
    expect(
      productionRecoveryReady(
        { mode: "daily-offsite", providerBackupAt: fresh },
        now,
      ),
    ).toBe(false);
    expect(
      productionRecoveryReady(
        {
          mode: "daily-offsite",
          providerBackupAt: fresh,
          offsiteBackupAt: fresh,
        },
        now,
      ),
    ).toBe(true);
    for (const invalid of [
      "bad-date",
      "2026-11-05T21:00:00Z",
      "2026-11-04T19:59:59Z",
    ]) {
      expect(
        productionRecoveryReady(
          {
            mode: "daily-offsite",
            providerBackupAt: fresh,
            offsiteBackupAt: invalid,
          },
          now,
        ),
      ).toBe(false);
      expect(
        productionRecoveryReady(
          {
            mode: "daily-offsite",
            providerBackupAt: invalid,
            offsiteBackupAt: fresh,
          },
          now,
        ),
      ).toBe(false);
    }
    expect(
      productionRecoveryReady(
        {
          mode: "daily-offsite",
          providerBackupAt: "2026-11-04T20:00:00Z",
          offsiteBackupAt: fresh,
        },
        now,
      ),
    ).toBe(true);
    expect(
      productionRecoveryReady(
        { mode: "pitr", retentionDays: 7, latestRestorePointAt: fresh },
        now,
      ),
    ).toBe(true);
    expect(
      productionRecoveryReady(
        { mode: "pitr", retentionDays: 6, latestRestorePointAt: fresh },
        now,
      ),
    ).toBe(false);
    expect(
      productionRecoveryReady(
        { mode: "pitr", retentionDays: "7", latestRestorePointAt: fresh },
        now,
      ),
    ).toBe(false);
    expect(
      productionRecoveryReady(
        {
          mode: "pitr",
          retentionDays: 7,
          latestRestorePointAt: "2026-11-04T19:59:59Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      productionRecoveryReady(
        { mode: "daily", providerBackupAt: fresh, offsiteBackupAt: fresh },
        now,
      ),
    ).toBe(false);
  });
  it("requires activated charges, payouts and complete business verification before commercial release", () => {
    const ready = {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [] },
    };
    expect(stripeAccountReady(ready)).toBe(true);
    expect(stripeAccountReady({})).toBe(false);
    for (const field of [
      "charges_enabled",
      "payouts_enabled",
      "details_submitted",
    ])
      expect(stripeAccountReady({ ...ready, [field]: false })).toBe(false);
    expect(
      stripeAccountReady({
        ...ready,
        requirements: { disabled_reason: "requirements.past_due" },
      }),
    ).toBe(false);
    expect(
      stripeAccountReady({
        ...ready,
        requirements: { currently_due: ["business_type"] },
      }),
    ).toBe(false);
    expect(
      stripeAccountReady({
        ...ready,
        requirements: { past_due: ["business_type"] },
      }),
    ).toBe(false);
  });
  it("rejects control-character and backslash redirect bypasses", () => {
    for (const path of [
      "https://outside.example",
      "//outside.example",
      "/\\outside.example",
      "/\t/outside.example",
      "/\n\\outside.example",
      "\n/app",
      "/app\u0000",
    ])
      expect(safeNext(path)).toBe("/app");
    expect(safeNext("/app/jobs?edit=abc#work")).toBe("/app/jobs?edit=abc#work");
  });
  it("masks current public token paths and drops query credentials", () => {
    for (const route of ["estimate", "invoice", "invite", "payment-return"])
      expect(maskTokenPath(`/${route}/secret-bearer-token?code=private`)).toBe(
        `/${route}/[token]`,
      );
    expect(maskTokenPath("/auth/callback?code=private&next=/app")).toBe(
      "/auth/callback",
    );
  });
  it("never includes driver messages or bound parameters in diagnostics", () => {
    const error = Object.assign(
      new Error("select secret-password, customer@example.com"),
      { cause: { code: "23505", message: "private-token" } },
    );
    expect(safeErrorDiagnostic(error)).toEqual({
      errorName: "Error",
      errorCode: "23505",
    });
    expect(JSON.stringify(safeErrorDiagnostic(error))).not.toMatch(
      /password|customer|private-token/,
    );
  });
  it("requires MFA when enforced or enrolled, including unavailable AAL", () => {
    expect(mfaNeeded(true, "aal1", "aal1")).toBe(true);
    expect(mfaNeeded(true, null, null)).toBe(true);
    expect(mfaNeeded(false, "aal1", "aal2")).toBe(true);
    expect(mfaNeeded(true, "aal2", "aal2")).toBe(false);
    expect(mfaNeeded(false, "aal1", "aal1")).toBe(false);
  });
  it("fails release readiness closed and cannot treat a masked public key as build-ready", () => {
    expect(releaseConfiguration({}).every((c) => c.ready)).toBe(false);
    expect(
      releaseConfiguration(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "[SENSITIVE]",
        },
        true,
      ).find((c) => c.key === "public-auth")?.ready,
    ).toBe(false);
    expect(
      releaseConfiguration({
        DEV_OWNER_EMAIL: "disabled-bootstrap-removed",
        DEV_OWNER_TEMP_PASSWORD: "disabled-bootstrap-removed",
      }).find((c) => c.key === "no-setup-credentials")?.ready,
    ).toBe(true);
  });
  it("throttles reset attempts atomically, stores only keyed hashes, and refuses app-role reads", async () => {
    const email = `reset-${randomUUID()}@example.test`,
      ip = `test-${randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => checkAuthThrottle("reset", email, ip)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const raw = await withGlobalWorker((tx) =>
      tx.execute(sql`SELECT key_hash FROM app.auth_rate_limit`),
    );
    expect(
      raw.rows.every((r) => /^[a-f0-9]{64}$/.test(String(r.key_hash))),
    ).toBe(true);
    const t = await seedTenant("Throttle isolation");
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) =>
        tx.execute(sql`SELECT * FROM app.auth_rate_limit`),
      ),
    ).rejects.toThrow();
  });
});
describe("owner exports and scheduled maintenance", () => {
  it("exports only the owner tenant, pages more than 500 rows, and strips link credentials", async () => {
    const a = await seedTenant("Export", { withStaff: true }),
      b = await seedTenant("Other export");
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      tx.execute(
        sql`INSERT INTO app.customer(business_id,first_name,last_name,display_name) SELECT ${a.businessId},'Export','','Export '||n FROM generate_series(1,503) n`,
      ),
    );
    const c = await withTenant(b.businessId, b.owner.actor, (tx) =>
      createCustomer(tx, meta(), {
        firstName: "Other tenant secret",
        lastName: "",
      }),
    );
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      authorizeExport(tx, meta(), "customers"),
    );
    const text = await new Response(
      exportStream(a.businessId, a.owner.actor, "customers"),
    ).text();
    const lines = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(504);
    expect(lines[0].format).toBe("shop-revenue-ndjson-v1");
    expect(text).not.toContain(c.id);
    expect(text).not.toContain("Other tenant secret");
    await expect(
      withTenant(a.businessId, a.staff!.actor, (tx) =>
        exportPage(tx, "customers", new Date()),
      ),
    ).rejects.toThrow(/owner/);
    await expect(
      withTenant(a.businessId, { type: "support", id: null }, (tx) =>
        authorizeExport(tx, meta(), "customers"),
      ),
    ).rejects.toThrow();
    expect(
      exportRecord({
        tokenHash: "secret",
        snapshot: { inviteToken: "private", subtotalCents: 1000 },
        email: "owner@example.test",
      }),
    ).toEqual({
      snapshot: { subtotalCents: 1000 },
      email: "owner@example.test",
    });
  });
  it("executes due revenue jobs through worker privileges and records a real heartbeat", async () => {
    const t = await seedTenant("Maintenance");
    await withTenant(t.businessId, t.owner.actor, (tx) =>
      tx.execute(
        sql`SELECT app.enqueue_job('reconcile_revenue',jsonb_build_object('business_id',${t.businessId}::text),now(),3,${"test-maintenance-" + randomUUID()})`,
      ),
    );
    const result = await runMaintenanceBatch({ limit: 2, budgetMs: 10000 });
    expect(result.status).toBe("succeeded");
    expect(result.completed).toBeGreaterThan(0);
    expect((await maintenanceStatus()).healthy).toBe(true);
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) =>
        tx.execute(sql`SELECT * FROM app.maintenance_run`),
      ),
    ).rejects.toThrow();
    // Visits every shop in the test database (Monday summaries, Mon-Wed).
  }, 120_000);
  it("rejects a mismatched vehicle while maintaining export tenant isolation", async () => {
    const a = await seedTenant("Vehicles"),
      b = await seedTenant("Other vehicles");
    const c = await withTenant(b.businessId, b.owner.actor, (tx) =>
      createCustomer(tx, meta(), { firstName: "Private owner", lastName: "" }),
    );
    const v = await withTenant(b.businessId, b.owner.actor, (tx) =>
      createVehicle(tx, meta(), { customerId: c.id, make: "Private vehicle" }),
    );
    const rows = await withTenant(a.businessId, a.owner.actor, (tx) =>
      exportPage(tx, "vehicles", new Date()),
    );
    expect(rows.some((r) => r.id === v.id)).toBe(false);
  });
});
