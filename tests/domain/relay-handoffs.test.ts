import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { assignAdvisor, assignCustomer, assignJob } from "@/domain/assignments";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate } from "@/domain/estimates";
import {
  handOffApprovedWork,
  prepareHandoffPing,
} from "@/domain/handoff-pings";
import { getInspection, saveInspection } from "@/domain/inspections";
import { issueInvoice } from "@/domain/invoices";
import { listMyJobHandoffs } from "@/domain/job-handoffs";
import { loadJobWorkflows, recordJobProgress } from "@/domain/job-workflow";
import { createJob, getJob } from "@/domain/jobs";
import { acceptInvite, inviteStaff } from "@/domain/membership";
import { listTasks } from "@/domain/tasks";
import {
  MemoryEmailProvider,
  setEmailProviderForTests,
} from "@/providers/email";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

const mail = new MemoryEmailProvider();
beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.EMAIL_FROM_ADDRESS = "test@example.test";
  setEmailProviderForTests(mail);
});
afterAll(() => setEmailProviderForTests(null));

// A shop with an owner, an advisor, a technician and one RO with two lines.
async function shop(label: string) {
  const t = await seedTenant(label, { withStaff: true });
  const as =
    (actor: Parameters<typeof withTenant>[1]) =>
    <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, actor, fn);
  const owner = as(t.owner.actor);
  const advisor = as(t.staff!.actor);
  const techEmail = `tech-${randomUUID()}@shop.example.test`;
  const inv = await owner((tx) =>
    inviteStaff(tx, meta(), {
      name: "Tess Tech",
      email: techEmail,
      role: "technician",
    }),
  );
  const authSubject = randomUUID();
  const joined = await acceptInvite(meta(), inv.token, {
    authSubject,
    email: techEmail,
    phoneE164: null,
    displayName: "Tess Tech",
  });
  const tech = as({ type: "user", id: joined.userId, authSubject });
  const c = await owner((tx) =>
    createCustomer(tx, meta(), { firstName: "Relay", lastName: "TEST" }),
  );
  const v = await owner((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await owner((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brake noise",
      parts: [
        {
          description: "Brake pads",
          quantity: 1,
          unitCostCents: 1000,
          unitPriceCents: 2000,
        },
      ],
      labor: [
        {
          description: "Alignment",
          estimatedHoursHundredths: 100,
          actualHoursHundredths: null,
          costRateCents: 1000,
          sellRateCents: 5000,
        },
      ],
    }),
  );
  // The advisor can only price work for a customer assigned to them.
  await owner((tx) => assignCustomer(tx, meta(), {customerId: c.id, userId: t.staff!.userId}));
  const f = { t, owner, advisor, tech, techEmail, techId: joined.userId, job };
  const inbox = async (run: typeof owner) =>
    (await run((tx) => listMyJobHandoffs(tx))).map((h) => h.stage);
  // Advisor publishes the estimate after the technician's inspection.
  const publish = async () => {
    const saved = (await advisor((tx) => getJob(tx, job.id)))!;
    return advisor((tx) =>
      freezeEstimate(tx, meta(), {
        jobId: job.id,
        expectedJobVersion: saved.version,
        taxBps: 0,
        supplementReason: "",
        terms: "",
      }),
    );
  };
  const inspect = async () => {
    const inspection = await tech((tx) => getInspection(tx, job.id));
    await tech((tx) =>
      saveInspection(tx, meta(), {
        jobId: job.id,
        submit: true,
        assessment: {
          diagnosis: "Pads worn",
          bay: "Bay 1",
          vehiclePickedUp: true,
        },
        items: inspection.items.map((i) => ({
          ...i,
          status: "good" as const,
        })),
      }),
    );
  };
  const progress = (
    run: typeof owner,
    versionId: string,
    status: "in_progress" | "completed",
    note = "",
  ) =>
    run(async (tx) => {
      const flow = (await loadJobWorkflows(tx, [job.id])).get(job.id)!;
      return recordJobProgress(tx, meta(), {
        jobId: job.id,
        versionId,
        expectedStatus: flow.work,
        status,
        note,
      });
    });
  return { ...f, inbox, publish, inspect, progress };
}

describe("RO relay after the estimate", () => {
  it("customer approval goes to the technician, finished work to the advisor, and invoicing clears it", async () => {
    const f = await shop("Relay");
    await f.owner((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.staff!.userId }),
    );
    await f.owner((tx) =>
      assignJob(tx, meta(), { jobId: f.job.id, userId: f.techId }),
    );
    await f.inspect();
    expect(await f.inbox(f.advisor)).toEqual(["build_estimate"]);
    const estimate = await f.publish();
    expect(await f.inbox(f.advisor)).toEqual([]);
    expect(await f.inbox(f.tech)).toEqual([]);

    // The customer approves the pads and declines the alignment.
    const token = estimate.path.split("/").pop()!;
    await signTestEstimate(token, "Relay TEST", ["part-0"], meta());
    expect(await handOffApprovedWork(token)).toBe(true);
    expect(await f.inbox(f.tech)).toEqual(["perform_work"]);
    const toTech = mail.sent.filter((m) => m.to === f.techEmail).at(-1)!;
    expect(toTech.subject).toMatch(
      /^Approved, start the work: RO-[0-9A-F]+ · Brake noise$/,
    );
    expect(toTech.text).toContain("do only what was authorized");
    expect(toTech.text).not.toMatch(/Relay TEST|\$|20\.00/);
    const task = (await f.tech((tx) => listTasks(tx))).due.find(
      (x) => x.subjectId === f.job.id,
    );
    expect(task?.title).toContain("do the authorized work");

    // The technician does the work; the advisor is told to invoice.
    await f.progress(f.tech, estimate.id, "in_progress");
    expect(await f.inbox(f.advisor)).toEqual([]);
    const done = await f.progress(f.tech, estimate.id, "completed");
    expect(done.handoff).toBe(true);
    expect(await f.inbox(f.tech)).toEqual([]);
    expect(await f.inbox(f.advisor)).toEqual(["invoice_customer"]);
    const toAdvisor = await f.tech((tx) => prepareHandoffPing(tx, f.job.id));
    expect(toAdvisor?.email.to).toBe(f.t.staff!.email);
    expect(toAdvisor?.email.subject).toMatch(
      /^Work complete, invoice the customer: RO-/,
    );
    expect(toAdvisor?.email.text).toContain(
      "Tess Tech finished the authorized work",
    );

    // Reopened work returns to the technician, then back to the advisor.
    const reopened = await f.progress(
      f.advisor,
      estimate.id,
      "in_progress",
      "Customer reports the noise is still there",
    );
    expect(reopened.handoff).toBe(true);
    expect(await f.inbox(f.tech)).toEqual(["perform_work"]);
    expect(await f.inbox(f.advisor)).toEqual([]);
    await f.progress(f.tech, estimate.id, "completed");

    // Handing the RO to another advisor moves the invoice task with it.
    const moved = await f.owner((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.owner.userId }),
    );
    expect(moved.handoff).toBe(true);
    expect(await f.inbox(f.advisor)).toEqual([]);
    expect(await f.inbox(f.owner)).toEqual(["invoice_customer"]);

    // Issuing the invoice finishes the relay.
    await f.owner((tx) =>
      issueInvoice(tx, meta(), {
        versionId: estimate.id,
        dueOn: null,
        terms: "",
      }),
    );
    expect(await f.inbox(f.owner)).toEqual([]);
    expect(await f.inbox(f.tech)).toEqual([]);
  });

  it("hands nothing off when the customer declines everything", async () => {
    const f = await shop("RelayNo");
    await f.owner((tx) =>
      assignJob(tx, meta(), { jobId: f.job.id, userId: f.techId }),
    );
    await f.inspect();
    const estimate = await f.publish();
    const token = estimate.path.split("/").pop()!;
    await signTestEstimate(token, "Relay TEST", [], meta());
    const before = mail.sent.length;
    expect(await handOffApprovedWork(token)).toBe(false);
    expect(await f.inbox(f.tech)).toEqual([]);
    expect(mail.sent.length).toBe(before);
    expect(await handOffApprovedWork("x".repeat(43))).toBe(false);
  });

  it("a technician assigned after approval gets the approved work; with no advisor assigned the owner invoices", async () => {
    const f = await shop("RelayLate");
    const estimate = await f.publish();
    const token = estimate.path.split("/").pop()!;
    await signTestEstimate(token, "Relay TEST", ["part-0", "labor-0"], meta());
    // Nobody is on the RO yet, so there is nobody to hand it to.
    expect(await handOffApprovedWork(token)).toBe(false);
    const assigned = await f.owner((tx) =>
      assignJob(tx, meta(), { jobId: f.job.id, userId: f.techId }),
    );
    expect(assigned.handoff).toBe(true);
    expect(await f.inbox(f.tech)).toEqual(["perform_work"]);
    await f.progress(f.tech, estimate.id, "in_progress");
    await f.progress(f.tech, estimate.id, "completed");
    expect(await f.inbox(f.owner)).toEqual(["invoice_customer"]);
    expect(await f.inbox(f.advisor)).toEqual([]);
  });

  it("skips the invoice task when the work was already invoiced", async () => {
    const f = await shop("RelayPre");
    await f.owner((tx) =>
      assignJob(tx, meta(), { jobId: f.job.id, userId: f.techId }),
    );
    await f.inspect();
    const estimate = await f.publish();
    const token = estimate.path.split("/").pop()!;
    await signTestEstimate(token, "Relay TEST", ["part-0"], meta());
    await handOffApprovedWork(token);
    await f.owner((tx) =>
      issueInvoice(tx, meta(), {
        versionId: estimate.id,
        dueOn: null,
        terms: "",
      }),
    );
    await f.progress(f.tech, estimate.id, "in_progress");
    const done = await f.progress(f.tech, estimate.id, "completed");
    expect(done.handoff).toBe(false);
    expect(await f.inbox(f.owner)).toEqual([]);
  });
});
