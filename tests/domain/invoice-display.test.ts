import { expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate } from "@/domain/estimates";
import { issueInvoice, readPublicInvoice } from "@/domain/invoices";
import {
  setInvoiceDisplay,
  setInvoiceTemplate,
} from "@/domain/invoice-display";
import { createJob, getJob } from "@/domain/jobs";
import {
  DEFAULT_INVOICE_DISPLAY,
  effectiveDisplay,
} from "@/lib/invoice-display";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

it("new invoices follow the owner's template; one invoice can override it or reset", async () => {
  const t = await seedTenant("Invoice layout", { withStaff: true });
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Layout", lastName: "TEST" }),
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
          description: "Pads",
          quantity: 1,
          unitCostCents: 1,
          unitPriceCents: 5000,
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
  await signTestEstimate(e.path.split("/").pop()!, "L", ["part-0"], meta());
  const inv = await run((tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
  );
  const token = inv.path.split("/").pop()!;
  const shown = async () => {
    const p = await readPublicInvoice(token);
    return effectiveDisplay(p!.displayTemplate, p!.display);
  };
  expect(await shown()).toEqual(DEFAULT_INVOICE_DISPLAY);
  // Staff can't change the shop-wide template.
  await expect(
    withTenant(t.businessId, t.staff!.actor, (tx) =>
      setInvoiceTemplate(tx, meta(), { lineDetail: false }),
    ),
  ).rejects.toThrow();
  await run((tx) =>
    setInvoiceTemplate(tx, meta(), {
      lineDetail: false,
      thankYouText: "Thanks, neighbor!",
    }),
  );
  expect(await shown()).toMatchObject({
    lineDetail: false,
    thankYouText: "Thanks, neighbor!",
  });
  await withTenant(t.businessId, t.staff!.actor, (tx) =>
    setInvoiceDisplay(tx, meta(), inv.id, { lineDetail: true, terms: false }),
  );
  expect(await shown()).toMatchObject({
    lineDetail: true,
    terms: false,
    thankYouText: "Thanks, neighbor!",
  });
  await run((tx) => setInvoiceDisplay(tx, meta(), inv.id, null));
  expect((await shown()).lineDetail).toBe(false);
  await expect(
    run((tx) => setInvoiceDisplay(tx, meta(), inv.id, { bogus: true })),
  ).rejects.toThrow();
});
