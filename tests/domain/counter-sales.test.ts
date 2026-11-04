import { describe, expect, it } from "vitest";
import { business } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { eq } from "drizzle-orm";
import {
  createCounterSale,
  getCounterSale,
  voidCounterSale,
} from "@/domain/counter-sales";
import { getOwnerMoney } from "@/domain/owner-money";
import { getPart, savePart } from "@/domain/parts";
import { closeRegister, registerDay } from "@/domain/register";
import { presetRange, runReport } from "@/domain/reports";
import { localDateKey } from "@/lib/timezone";
import { meta, seedTenant } from "../helpers/fixtures";

async function shop() {
  const t = await seedTenant("Counter");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  await run((tx) =>
    tx
      .update(business)
      .set({ taxRateBps: 825 })
      .where(eq(business.id, t.businessId)),
  );
  const wipers = await run((tx) =>
    savePart(tx, meta(), {
      name: "Wiper blades TEST",
      unitCostCents: 800,
      unitPriceCents: 2000,
      startingHundredths: 1000,
    }),
  );
  return { t, run, wipers };
}

describe("Quick sale", () => {
  it("sells parts and extras with tax, takes stock, and counts as money in", async () => {
    const f = await shop();
    const sale = await f.run((tx) =>
      createCounterSale(tx, meta(), {
        lines: [
          { partItemId: f.wipers.id, quantityHundredths: 200 },
          {
            description: "Bulb",
            quantityHundredths: 100,
            unitPriceCents: 500,
          },
        ],
        chargeTax: true,
        method: "cash",
        receivedCents: 5000,
      }),
    );
    // $40 + $5 = $45; tax 8.25% = $3.71; total $48.71; change $1.29.
    expect(sale).toMatchObject({
      number: 1,
      totalCents: 4871,
      changeCents: 129,
    });
    expect(
      (await f.run((tx) => getPart(tx, f.wipers.id)))!.onHandHundredths,
    ).toBe(800);

    const reg = await f.run((tx) => registerDay(tx));
    expect(reg.methods.find((m) => m.method === "cash")).toMatchObject({
      n: 1,
      cents: 4871,
    });
    expect(reg.cashCents).toBe(4871);

    const money = await f.run((tx) => getOwnerMoney(tx));
    expect(money.collectedCents).toBe(4871);
    expect(money.salesTaxCents).toBe(371);

    const range = presetRange(
      "month",
      localDateKey(new Date(), "America/Chicago"),
    );
    const payments = await f.run((tx) => runReport(tx, "payments", range));
    expect(payments.rows[0].slice(1, 6)).toEqual([
      "Sale #1",
      "Counter sale",
      "cash",
      null,
      4871,
    ]);

    // Next sale gets the next number; card, no tax.
    const second = await f.run((tx) =>
      createCounterSale(tx, meta(), {
        lines: [{ partItemId: f.wipers.id, quantityHundredths: 100 }],
        chargeTax: false,
        method: "external_card",
        reference: "4242",
      }),
    );
    expect(second).toMatchObject({ number: 2, totalCents: 2000 });
  });

  it("voids the same day only, before the drawer closes, and returns stock", async () => {
    const f = await shop();
    const s1 = await f.run((tx) =>
      createCounterSale(tx, meta(), {
        lines: [{ partItemId: f.wipers.id, quantityHundredths: 300 }],
        chargeTax: false,
        method: "cash",
      }),
    );
    await expect(
      f.run((tx) => voidCounterSale(tx, meta(), { id: s1.id, reason: " " })),
    ).rejects.toThrow(/Say why/);
    await f.run((tx) =>
      voidCounterSale(tx, meta(), { id: s1.id, reason: "Rang up twice" }),
    );
    expect(
      (await f.run((tx) => getPart(tx, f.wipers.id)))!.onHandHundredths,
    ).toBe(1000);
    expect((await f.run((tx) => registerDay(tx))).taken).toBe(0);
    await expect(
      f.run((tx) => voidCounterSale(tx, meta(), { id: s1.id, reason: "x" })),
    ).rejects.toThrow(/already voided/);

    // After the drawer is closed: locked.
    const s2 = await f.run((tx) =>
      createCounterSale(tx, meta(), {
        lines: [
          { description: "Fuse", quantityHundredths: 100, unitPriceCents: 300 },
        ],
        chargeTax: false,
        method: "cash",
      }),
    );
    const day = (await f.run((tx) => registerDay(tx))).day;
    await f.run((tx) =>
      closeRegister(tx, meta(), {
        day,
        startingCashCents: 0,
        countedCashCents: 300,
        note: "",
      }),
    );
    expect((await f.run((tx) => getCounterSale(tx, s2.id)))!.canVoid).toBe(
      false,
    );
    await expect(
      f.run((tx) => voidCounterSale(tx, meta(), { id: s2.id, reason: "x" })),
    ).rejects.toThrow(/same day, before the drawer is closed/);
  });

  it("explains what's missing", async () => {
    const f = await shop();
    await expect(
      f.run((tx) =>
        createCounterSale(tx, meta(), {
          lines: [{ quantityHundredths: 100 }],
          chargeTax: false,
          method: "cash",
        }),
      ),
    ).rejects.toThrow(/name and a price/);
    await expect(
      f.run((tx) =>
        createCounterSale(tx, meta(), {
          lines: [{ partItemId: f.wipers.id, quantityHundredths: 100 }],
          chargeTax: true,
          method: "cash",
          receivedCents: 100,
        }),
      ),
    ).rejects.toThrow(/less than the total/);
  });
});
