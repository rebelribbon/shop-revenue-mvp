import { beforeAll, expect, it } from "vitest";
import { runInterleaved, type InterleaveTenant } from "../helpers/interleave";
import { seedTenant } from "../helpers/fixtures";

let tenants: InterleaveTenant[];

beforeAll(async () => {
  const seeded = await Promise.all(["Hotel", "India", "Juliet"].map((l) => seedTenant(l, { withStaff: true })));
  tenants = seeded.flatMap((t) => [
    { businessId: t.businessId, actor: t.owner.actor },
    { businessId: t.businessId, actor: t.staff!.actor },
  ]);
});

it("1,000 interleaved requests across tenants on a shared pool never cross tenants", async () => {
  // 40 concurrent requests over the app pool (10 connections): constant reuse across tenants.
  const r = await runInterleaved(tenants, { requests: 1000, concurrency: 40 });
  expect(r.violations).toEqual([]);
  expect(r.tenantRequests + r.noContextRequests).toBe(1000);
}, 180_000);
