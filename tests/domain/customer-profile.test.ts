import { expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import {
  customerHistory,
  customerMoney,
  listCustomerJobs,
} from "@/domain/customer-profile";
import { freezeEstimate } from "@/domain/estimates";
import { issueInvoice, recordInvoicePayment } from "@/domain/invoices";
import { createJob, getJob } from "@/domain/jobs";
import {
  addNote,
  headsUpNotes,
  listNotes,
  setNoteHeadsUp,
} from "@/domain/memory";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

it("keeps profile notes pinned, history notes in the timeline, and job notes on the job", async () => {
  const t = await seedTenant("Profile notes");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Cranky", lastName: "TEST" }),
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
          unitCostCents: 4000,
          unitPriceCents: 10000,
        },
      ],
      labor: [],
    }),
  );
  await run((tx) =>
    addNote(tx, c.id, null, "Always cranky, tread with caution", {
      kind: "profile",
      headsUp: true,
    }),
  );
  const referral = await run((tx) =>
    addNote(tx, c.id, null, "Referred by Maria", { kind: "profile" }),
  );
  await run((tx) => addNote(tx, c.id, null, "Called and sent invoice"));
  await run((tx) =>
    addNote(tx, c.id, null, "Gate code 4412", { jobId: job.id }),
  );
  const notes = await run((tx) => listNotes(tx, c.id));
  expect(notes.filter((n) => n.kind === "profile").map((n) => n.body)).toEqual([
    "Always cranky, tread with caution",
    "Referred by Maria",
  ]);
  expect(
    (await run((tx) => listNotes(tx, c.id, undefined, { jobId: job.id }))).map(
      (n) => n.body,
    ),
  ).toEqual(["Gate code 4412"]);
  expect(
    (await run((tx) => headsUpNotes(tx, [c.id]))).map((n) => n.body),
  ).toEqual(["Always cranky, tread with caution"]);
  await run((tx) => setNoteHeadsUp(tx, c.id, referral.id, true));
  expect(await run((tx) => headsUpNotes(tx, [c.id]))).toHaveLength(2);
  const history = await run((tx) => customerHistory(tx, c.id));
  const logged = history.find((h) => h.summary.includes("Called and sent"));
  expect(logged).toMatchObject({ isNote: true, href: null });
  const jobNote = history.find((h) => h.summary.includes("Gate code"));
  expect(jobNote?.href).toBe(`/app/jobs?job=${job.id}`);
  expect(history.some((h) => h.summary.includes("Referred by"))).toBe(false);
  // Another customer's job can't hold this customer's note.
  const other = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Other", lastName: "TEST" }),
  );
  await expect(
    run((tx) => addNote(tx, other.id, null, "x", { jobId: job.id })),
  ).rejects.toThrow();
  // A history note can never be a heads-up.
  const log = await run((tx) => addNote(tx, c.id, null, "plain", {}));
  await expect(
    run((tx) => setNoteHeadsUp(tx, c.id, log.id, true)),
  ).rejects.toThrow();
});

it("shows the customer's jobs with status and what they owe and have paid", async () => {
  const t = await seedTenant("Profile money");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Money", lastName: "TEST" }),
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
          unitCostCents: 4000,
          unitPriceCents: 10000,
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
  await signTestEstimate(e.path.split("/").pop()!, "M", ["part-0"], meta());
  const inv = await run((tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
  );
  await run((tx) =>
    recordInvoicePayment(tx, meta(), {
      invoiceId: inv.id,
      amountCents: 4000,
      method: "cash",
      reference: "",
    }),
  );
  const [j] = await run((tx) => listCustomerJobs(tx, c.id));
  expect(j).toMatchObject({
    id: job.id,
    title: "Brakes",
    amountCents: 10000,
    balanceCents: 6000,
  });
  expect(await run((tx) => customerMoney(tx, c.id))).toMatchObject({
    billedCents: 10000,
    paidCents: 4000,
    owedCents: 6000,
  });
  const history = await run((tx) => customerHistory(tx, c.id));
  expect(history.find((h) => h.kind === "invoice.issued")?.href).toBe(
    `/app/invoices?invoiceId=${inv.id}`,
  );
  expect(history.find((h) => h.kind === "estimate.authorized")?.href).toBe(
    `/app/jobs?job=${job.id}`,
  );
});
