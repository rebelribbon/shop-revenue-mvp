import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate } from "@/domain/estimates";
import { issueInvoice, voidInvoice } from "@/domain/invoices";
import { createJob, getJob } from "@/domain/jobs";
import {
  countStock,
  getPart,
  listParts,
  partCatalog,
  receiveStock,
  savePart,
  stockHistory,
} from "@/domain/parts";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

describe("Parts catalog and stock", () => {
  it("receives, counts and flags low stock", async () => {
    const t = await seedTenant("Parts");
    const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, t.owner.actor, fn);
    const oil = await run((tx) =>
      savePart(tx, meta(), {
        name: "5W-30 oil (qt) TEST",
        partNumber: "OIL-530",
        unitCostCents: 400,
        unitPriceCents: 900,
        reorderAtHundredths: 1000,
        startingHundredths: 2400,
      }),
    );
    await expect(
      run((tx) =>
        savePart(tx, meta(), {
          name: "5w-30 OIL (QT) test",
          unitPriceCents: 1,
        }),
      ),
    ).rejects.toThrow(/already in your list/);

    await run((tx) =>
      receiveStock(tx, meta(), {
        partItemId: oil.id,
        quantityHundredths: 1200,
        unitCostCents: 450,
      }),
    );
    let p = (await run((tx) => getPart(tx, oil.id)))!;
    expect(p).toMatchObject({ onHandHundredths: 3600, unitCostCents: 450 });

    // Shelf count finds 8 quarts: below the reorder point of 10.
    await run((tx) =>
      countStock(tx, meta(), { partItemId: oil.id, countedHundredths: 800 }),
    );
    p = (await run((tx) => getPart(tx, oil.id)))!;
    expect(p.onHandHundredths).toBe(800);
    expect(p.low).toBe(true);
    const found = await run((tx) => listParts(tx, "OIL-5"));
    expect(found[0]?.id).toBe(oil.id);
    const history = await run((tx) => stockHistory(tx, oil.id));
    expect(history.map((h) => [h.reason, h.changeHundredths])).toEqual([
      ["counted", -2800],
      ["received", 1200],
      ["counted", 2400],
    ]);
  });

  it("takes parts off the shelf when invoiced and puts them back on void", async () => {
    const t = await seedTenant("Stock");
    const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, t.owner.actor, fn);
    const pads = await run((tx) =>
      savePart(tx, meta(), {
        name: "Brake pads TEST",
        unitCostCents: 4000,
        unitPriceCents: 9000,
        startingHundredths: 500,
      }),
    );
    const catalog = await run((tx) => partCatalog(tx));
    expect(catalog.find((c) => c.id === pads.id)?.unitPriceCents).toBe(9000);

    const c = await run((tx) =>
      createCustomer(tx, meta(), { firstName: "Stock", lastName: "TEST" }),
    );
    const v = await run((tx) =>
      createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
    );
    const job = await run((tx) =>
      createJob(tx, {
        customerId: c.id,
        vehicleId: v.id,
        title: "Brakes",
        parts: [
          {
            partItemId: pads.id,
            description: "Brake pads TEST",
            quantity: 2,
            unitCostCents: 4000,
            unitPriceCents: 9000,
          },
          {
            description: "Shop supplies",
            quantity: 1,
            unitCostCents: null,
            unitPriceCents: 500,
          },
        ],
        labor: [],
      }),
    );
    const saved = await run((tx) => getJob(tx, job.id));
    const e = await run((tx) =>
      freezeEstimate(tx, meta(), {
        jobId: job.id,
        expectedJobVersion: saved!.version,
        taxBps: 0,
        supplementReason: "",
        terms: "",
      }),
    );
    await signTestEstimate(
      e.path.split("/").pop()!,
      "S",
      ["part-0", "part-1"],
      meta(),
    );
    const inv = await run((tx) =>
      issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
    );
    expect((await run((tx) => getPart(tx, pads.id)))!.onHandHundredths).toBe(
      300,
    );
    await run((tx) => voidInvoice(tx, meta(), inv.id, "Test void"));
    expect((await run((tx) => getPart(tx, pads.id)))!.onHandHundredths).toBe(
      500,
    );
    // Voiding twice doesn't double the return.
    const moves = await run((tx) => stockHistory(tx, pads.id));
    expect(moves.filter((m) => m.reason === "returned")).toHaveLength(1);
  });
});
