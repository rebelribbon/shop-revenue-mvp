import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob, listJobs } from "@/domain/jobs";
import { freezeEstimate } from "@/domain/estimates";
import { meta, rawClient, seedTenant } from "../helpers/fixtures";

it("validates customer references on populated shops and removes migration-only visibility", async () => {
  for (const label of ["Upgrade A", "Upgrade B"]) {
    const shop = await seedTenant(label);
    await withTenant(shop.businessId, shop.owner.actor, async tx => {
      const customer = await createCustomer(tx, meta(), { firstName: label, lastName: "Customer" });
      const vehicle = await createVehicle(tx, meta(), { customerId: customer.id, make: "Upgrade" });
      const job = await createJob(tx, { customerId: customer.id, vehicleId: vehicle.id, title: "Existing job", parts: [{ description: "Part", quantity: 1, unitCostCents: 100, unitPriceCents: 200 }], labor: [] });
      const [saved] = await listJobs(tx);
      await freezeEstimate(tx, meta(), { jobId: job.id, expectedJobVersion: saved.version, taxBps: 0, supplementReason: "", terms: "" });
    });
  }
  const migration = readFileSync("db/migrations/0020_business_type_workspaces.sql", "utf8");
  const statements = migration.split(";").map(s => s.trim()).filter(s => /^(?:ALTER TABLE app\.(?:estimate_version|invoice|recommendation) ADD CONSTRAINT \w+_customer_fk|DROP POLICY workspace_migration_customer_validation)/.test(s));
  const policy = migration.match(/CREATE POLICY workspace_migration_customer_validation[^;]+;/)?.[0];
  expect(policy).toBeDefined();
  expect(statements).toHaveLength(4);
  const client = await rawClient("migration");
  await client.query("BEGIN");
  try {
    for (const table of ["estimate_version", "invoice", "recommendation"]) {
      await client.query(`ALTER TABLE app.${table} DROP CONSTRAINT ${table}_customer_fk`);
    }
    await client.query(policy!);
    await client.query(statements.join(";\n") + ";");
    const { rows } = await client.query("SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='app' AND policyname='workspace_migration_customer_validation'");
    expect(rows[0].count).toBe(0);
    const security = await client.query("SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS forced FROM pg_class WHERE oid IN ('app.customer'::regclass,'app.estimate_version'::regclass,'app.invoice'::regclass,'app.recommendation'::regclass)");
    expect(security.rows[0].forced).toBe(true);
    const customers = await client.query("SELECT count(*)::int AS count FROM app.customer");
    expect(customers.rows[0].count).toBe(0);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
