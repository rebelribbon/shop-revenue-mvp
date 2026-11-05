import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { freezeEstimate } from "@/domain/estimates";
import {
  issueInvoice,
  listInvoices,
  recordInvoicePayment,
  reverseInvoicePayment,
  voidInvoice,
} from "@/domain/invoices";
import { loadJobWorkflows } from "@/domain/job-workflow";
import { createJob, getJob, jobInput } from "@/domain/jobs";
import { unbilledLines } from "@/lib/supplement";
import { signTestEstimate } from "../helpers/authorization";
import { unpaidInvoice } from "../helpers/invoices";
import { meta } from "../helpers/fixtures";

type F = Awaited<ReturnType<typeof unpaidInvoice>>;

async function jobOf(f: F) {
  const r = await f.run((tx) =>
    tx.execute(sql`select quote_id from app.invoice where id=${f.invoiceId}`),
  );
  return String(r.rows[0].quote_id);
}

// Edit the job sheet, publish a supplement, have the customer sign it.
async function supplement(
  f: F,
  jobId: string,
  change: (data: ReturnType<typeof jobInput.parse>) => void,
  approve: (lineIds: string[]) => string[] = (ids) => ids,
) {
  const job = (await f.run((tx) => getJob(tx, jobId)))!;
  const data = jobInput.parse(job.data);
  change(data);
  await f.run((tx) =>
    createJob(tx, {
      ...data,
      jobId,
      expectedVersion: job.version,
    } as Parameters<typeof createJob>[1]),
  );
  const saved = (await f.run((tx) => getJob(tx, jobId)))!;
  const e = await f.run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId,
      expectedJobVersion: saved.version,
      taxBps: 0,
      supplementReason: "Found worn rotors",
      terms: "",
    }),
  );
  const ids = (await f.run((tx) => loadJobWorkflows(tx, [jobId])))
    .get(jobId)!
    .latest!.estimate.snapshot.lines.map((l) => l.id);
  await signTestEstimate(e.path.split("/").pop()!, "S", approve(ids), meta());
  return e;
}

const rotors = {
  description: "Rotors",
  quantity: 1,
  unitPriceCents: 4000,
  unitCostCents: 1500,
};

describe("Supplements on an invoiced job", () => {
  it("matches billed lines one-for-one", () => {
    const l = (description: string, unitPriceCents = 100) => ({
      id: description,
      description,
      quantity: 1,
      unitPriceCents,
      totalCents: unitPriceCents,
      kind: "part" as const,
    });
    expect(
      unbilledLines([l("A"), l("A"), l("B")], [l("A")]).map((x) => x.id),
    ).toEqual(["A", "B"]);
    expect(unbilledLines([l("A", 200)], [l("A", 100)])).toHaveLength(1);
  });

  it("bills only the extra work on an add-on invoice, and the job owes both", async () => {
    const f = await unpaidInvoice(null, null);
    const jobId = await jobOf(f);
    await f.run((tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: f.invoiceId,
        amountCents: 5000,
        method: "cash",
        reference: "",
      }),
    );
    const e = await supplement(f, jobId, (d) => d.parts.push(rotors));
    let flow = (await f.run((tx) => loadJobWorkflows(tx, [jobId]))).get(jobId)!;
    expect(flow.supplementDueCents).toBe(4000);
    expect(flow.supplementLines.map((l) => l.description)).toEqual(["Rotors"]);

    const addOn = await f.run((tx) =>
      issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
    );
    const [inv] = await f.run((tx) => listInvoices(tx, addOn.id));
    expect(inv.totalCents).toBe(4000);
    expect(inv.snapshot.lines.map((l) => l.description)).toEqual(["Rotors"]);
    expect(inv.invoiceTerms).toMatch(/Additional work, added to invoice #\d+/);

    flow = (await f.run((tx) => loadJobWorkflows(tx, [jobId]))).get(jobId)!;
    // $120 + $40 billed, $50 paid.
    expect(flow.balanceCents).toBe(11000);
    expect(flow.supplementDueCents).toBe(0);
    expect(flow.addOnInvoices.map((i) => i.id)).toEqual([addOn.id]);

    await expect(
      f.run((tx) =>
        issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
      ),
    ).rejects.toThrow(/already on invoice/);
  });

  it("won't let a supplement change work that's already billed", async () => {
    const f = await unpaidInvoice(null, null);
    const jobId = await jobOf(f);
    const job = (await f.run((tx) => getJob(tx, jobId)))!;
    const data = jobInput.parse(job.data);
    data.labor[0].sellRateCents = 15000;
    await f.run((tx) =>
      createJob(tx, {
        ...data,
        jobId,
        expectedVersion: job.version,
      } as Parameters<typeof createJob>[1]),
    );
    const saved = (await f.run((tx) => getJob(tx, jobId)))!;
    await expect(
      f.run((tx) =>
        freezeEstimate(tx, meta(), {
          jobId,
          expectedJobVersion: saved.version,
          taxBps: 0,
          supplementReason: "Price change",
          terms: "",
        }),
      ),
    ).rejects.toThrow(
      /is already on invoice #\d+. A supplement can only add work/,
    );
  });

  it("declined extra work leaves nothing to bill", async () => {
    const f = await unpaidInvoice(null, null);
    const jobId = await jobOf(f);
    await supplement(
      f,
      jobId,
      (d) => d.parts.push(rotors),
      (ids) => ids.filter((id) => !id.startsWith("part")),
    );
    const flow = (await f.run((tx) => loadJobWorkflows(tx, [jobId]))).get(
      jobId,
    )!;
    expect(flow.supplementDueCents).toBe(0);
    expect(flow.stage).not.toBe("bill");
  });

  it("voids the add-on before the main invoice", async () => {
    const f = await unpaidInvoice(null, null);
    const jobId = await jobOf(f);
    const e = await supplement(f, jobId, (d) => d.parts.push(rotors));
    const addOn = await f.run((tx) =>
      issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
    );
    await expect(
      f.run((tx) => voidInvoice(tx, meta(), f.invoiceId, "Redo")),
    ).rejects.toThrow(/Void add-on invoice #\d+ first/);
    await f.run((tx) => voidInvoice(tx, meta(), addOn.id, "Redo"));
    const pay = await f.run((tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: f.invoiceId,
        amountCents: 1000,
        method: "cash",
        reference: "",
      }),
    );
    await f.run((tx) =>
      reverseInvoicePayment(tx, meta(), pay.id, "Refunded at counter"),
    );
    await f.run((tx) => voidInvoice(tx, meta(), f.invoiceId, "Redo"));
    const flow = (await f.run((tx) => loadJobWorkflows(tx, [jobId]))).get(
      jobId,
    )!;
    expect(flow.currentInvoice).toBeNull();
    expect(flow.balanceCents).toBe(0);
  });
});
