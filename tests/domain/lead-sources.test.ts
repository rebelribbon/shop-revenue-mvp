import { describe, expect, it } from "vitest";
import { recordInvoicePayment } from "@/domain/invoices";
import { setLeadSource } from "@/domain/customers";
import { buildReport, readConfig } from "@/domain/report-builder";
import { presetRange, runReport } from "@/domain/reports";
import { unpaidInvoice } from "../helpers/invoices";
import { meta } from "../helpers/fixtures";
import { localDateKey } from "@/lib/timezone";

describe("Lead sources", () => {
  it("tags a customer and groups sales and payments by where they found you", async () => {
    const f = await unpaidInvoice(null, null);
    await f.run((tx) =>
      setLeadSource(tx, meta(), {
        customerId: f.customerId,
        leadSource: "referral",
        detail: "  Sam at the body shop ",
      }),
    );
    await f.run((tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: f.invoiceId,
        amountCents: 12000,
        method: "cash",
        reference: "",
      }),
    );
    const range = presetRange(
      "month",
      localDateKey(new Date(), "America/Chicago"),
    );
    const sales = await f.run((tx) => runReport(tx, "sales", range));
    expect(sales.columns.at(-1)?.label).toBe("Found us");
    expect(sales.rows[0].at(-1)).toBe("Referral");
    expect(sales.totals).toHaveLength(sales.columns.length);

    const bySource = await f.run((tx) =>
      buildReport(
        tx,
        readConfig({ source: "sales", group: "source", measures: "total" }),
        range,
      ),
    );
    expect(bySource.rows).toEqual([["Referral", 12000]]);
    expect(bySource.headline).toBe("Referral leads with $120.00 total billed.");

    const paid = await f.run((tx) =>
      buildReport(
        tx,
        readConfig({ source: "payments", group: "source", measures: "amount" }),
        range,
      ),
    );
    expect(paid.rows).toEqual([["Referral", 12000]]);

    // Cleared: shows as "Not set".
    await f.run((tx) =>
      setLeadSource(tx, meta(), {
        customerId: f.customerId,
        leadSource: null,
        detail: null,
      }),
    );
    const profit = await f.run((tx) =>
      buildReport(
        tx,
        readConfig({ source: "profit", group: "source", measures: "count" }),
        range,
      ),
    );
    expect(profit.rows).toEqual([["Not set", 1]]);
  });
});
