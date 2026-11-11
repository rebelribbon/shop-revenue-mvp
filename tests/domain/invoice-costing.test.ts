import { expect, it } from "vitest";
import { quotedInvoiceCost } from "@/domain/invoice-costing";
import type { InvoiceSnapshot } from "@/db/schema";
const job = {
  customerId: "00000000-0000-4000-8000-000000000001",
  vehicleId: "00000000-0000-4000-8000-000000000002",
  title: "Partial",
  parts: [
    {
      description: "Approved",
      quantity: 2,
      unitCostCents: 1000,
      unitPriceCents: 10000,
    },
    {
      description: "Declined",
      quantity: 1,
      unitCostCents: 9000,
      unitPriceCents: 10000,
    },
  ],
  labor: [],
};
const snapshot = {
  title: "Partial",
  shopName: "Shop",
  customerName: "Customer",
  vehicleLabel: "Ford",
  lines: [
    {
      id: "part-0",
      description: "Approved",
      kind: "part",
      quantity: 2,
      unitPriceCents: 10000,
      totalCents: 20000,
    },
  ],
  subtotalCents: 20000,
  taxBps: 0,
  taxCents: 0,
  totalCents: 20000,
  terms: "",
} satisfies InvoiceSnapshot;
it("costs only approved lines instead of scaling the full quote by selling price", () => {
  expect(quotedInvoiceCost(snapshot, job).costCents).toBe(2000);
  expect(
    quotedInvoiceCost(snapshot, {
      ...job,
      parts: [{ ...job.parts[0], unitCostCents: 0 }],
    }).costCents,
  ).toBe(0);
});
it("keeps missing, mismatched and absent cost histories unknown", () => {
  expect(quotedInvoiceCost(snapshot, undefined).costCents).toBeNull();
  expect(
    quotedInvoiceCost(snapshot, {
      ...job,
      parts: [{ ...job.parts[0], unitCostCents: null }],
    }).costCents,
  ).toBeNull();
  expect(
    quotedInvoiceCost(snapshot, {
      ...job,
      parts: [{ ...job.parts[0], description: "Different" }],
    }).costCents,
  ).toBeNull();
});
