import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate } from "@/domain/estimates";
import { issueInvoice } from "@/domain/invoices";
import { createJob, getJob } from "@/domain/jobs";
import { signTestEstimate } from "./authorization";
import { meta, seedTenant } from "./fixtures";

// A shop with one signed estimate turned into a $120 unpaid invoice.
export async function unpaidInvoice(
  email: string | null,
  dueOn: string | null,
) {
  const t = await seedTenant("Remind");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), {
      firstName: "Remy",
      lastName: "TEST",
      ...(email ? { email } : {}),
    }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brakes",
      parts: [],
      labor: [
        {
          description: "Labor",
          estimatedHoursHundredths: 100,
          actualHoursHundredths: null,
          sellRateCents: 12000,
          costRateCents: null,
        },
      ],
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
  await signTestEstimate(e.path.split("/").pop()!, "S", ["labor-0"], meta());
  const inv = await run((tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn, terms: "" }),
  );
  return { t, run, customerId: c.id, invoiceId: inv.id };
}
