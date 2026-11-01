import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import {
  archiveCustomer,
  archiveVehicle,
  createCustomer,
  createVehicle,
  getCustomerWithVehicles,
  listCustomerTimeline,
  listCustomers,
  updateCustomer,
  updateVehicle,
} from "@/domain/customers";
import { updateBusinessProfile } from "@/domain/business-profile";
import { meta, seedTenant, type SeededTenant } from "../helpers/fixtures";

let a: SeededTenant;
let b: SeededTenant;
beforeAll(async () => {
  a = await seedTenant("Memory");
  b = await seedTenant("Other memory");
});

describe("M2 mutations under the real app role", () => {
  it("saves customer and vehicle edits and archives without losing history", async () => {
    const c = await withTenant(a.businessId, a.owner.actor, (tx) =>
      createCustomer(tx, meta(), { firstName: "Alex", lastName: "Original" }),
    );
    const changed = await withTenant(a.businessId, a.owner.actor, (tx) =>
      updateCustomer(tx, meta(), c.id, {
        firstName: "Alex",
        lastName: "Updated",
        notes: "Retain customer notes",
      }),
    );
    expect(changed.displayName).toBe("Alex Updated");
    expect(changed.notes).toBe("Retain customer notes");
    expect(changed.updatedAt.getTime()).toBeGreaterThanOrEqual(
      c.updatedAt.getTime(),
    );
    const v = await withTenant(a.businessId, a.owner.actor, (tx) =>
      createVehicle(tx, meta(), {
        customerId: c.id,
        make: "BMW",
        model: "X5",
        mileage: 12000,
      }),
    );
    const edited = await withTenant(a.businessId, a.owner.actor, (tx) =>
      updateVehicle(tx, meta(), v.id, {
        customerId: c.id,
        make: "BMW",
        model: "X5",
        mileage: 12500,
        notes: "Retain vehicle notes",
      }),
    );
    expect(edited.mileage).toBe(12500);
    expect(edited.notes).toBe("Retain vehicle notes");
    await expect(
      withTenant(b.businessId, b.owner.actor, (tx) =>
        updateCustomer(tx, meta(), c.id, {
          firstName: "Intruder",
          lastName: "",
        }),
      ),
    ).rejects.toThrow();
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      archiveVehicle(tx, meta(), c.id, v.id),
    );
    const detail = await withTenant(a.businessId, a.owner.actor, (tx) =>
      getCustomerWithVehicles(tx, c.id),
    );
    expect(detail.vehicles).toHaveLength(0);
    const history = await withTenant(a.businessId, a.owner.actor, (tx) =>
      listCustomerTimeline(tx, c.id),
    );
    expect(history.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        "customer.updated",
        "vehicle.updated",
        "vehicle.archived",
      ]),
    );
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      archiveCustomer(tx, meta(), c.id),
    );
    expect(
      await withTenant(a.businessId, a.owner.actor, (tx) =>
        listCustomers(tx, "Alex Updated"),
      ),
    ).toHaveLength(0);
  });

  it("saves business profile fields without granting access to protected columns", async () => {
    const row = await withTenant(a.businessId, a.owner.actor, (tx) =>
      updateBusinessProfile(tx, meta(), {
        legalName: "Memory Auto LLC",
        city: "Austin",
        region: "TX",
        timezone: "America/Chicago",
      }),
    );
    expect(row.city).toBe("Austin");
    expect(row.timezone).toBe("America/Chicago");
  });
});
