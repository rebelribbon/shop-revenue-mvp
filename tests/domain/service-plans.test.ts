import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { appointment, invoice } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { setAppointmentStatus } from "@/domain/appointments";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate } from "@/domain/estimates";
import { voidInvoice } from "@/domain/invoices";
import { loadJobWorkflows } from "@/domain/job-workflow";
import { createJob, getJob, type JobInput } from "@/domain/jobs";
import {
  billPlanVisits,
  listServicePlans,
  recurringRevenue,
  rollForward,
  runServicePlanMaintenance,
  setServicePlanStatus,
  startServicePlan,
} from "@/domain/service-plans";
import {
  repeatSummary,
  repeatValue,
  visitDate,
  visitsThrough,
  type Repeat,
} from "@/lib/service-plans";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

describe("schedule math", () => {
  const weekly: Repeat = {
    every: "week",
    startOn: "2026-11-03",
    until: { kind: "visits", count: 3 },
    billing: "per_visit",
  };
  it("steps weeks and months, clamping short months", () => {
    expect(visitDate(weekly, 2)).toBe("2026-11-17");
    expect(visitDate({ every: "2weeks", startOn: "2026-12-29" }, 1)).toBe(
      "2027-01-12",
    );
    const monthly = { every: "month" as const, startOn: "2027-01-31" };
    expect([0, 1, 2, 3].map((n) => visitDate(monthly, n))).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
    expect(visitDate({ every: "year", startOn: "2028-02-29" }, 1)).toBe(
      "2029-02-28",
    );
  });
  it("stops at the visit count or end date", () => {
    expect(visitsThrough(weekly, "2027-12-31").map((v) => v.on)).toEqual([
      "2026-11-03",
      "2026-11-10",
      "2026-11-17",
    ]);
    expect(
      visitsThrough(
        { ...weekly, until: { kind: "date", on: "2026-11-12" } },
        "2027-12-31",
      ),
    ).toHaveLength(2);
  });
  it("describes the terms in plain words and values the plan", () => {
    expect(repeatSummary({ ...weekly, time: "08:30" }, 4500)).toBe(
      "Every week on Tuesdays around 8:30 a.m., starting Nov 3, 2026, for 3 visits. $45 per visit, billed after each visit. You can stop future visits at any time.",
    );
    expect(
      repeatSummary({
        every: "3months",
        startOn: "2026-11-15",
        until: { kind: "stopped" },
        billing: "monthly",
      }),
    ).toContain("Every 3 months on the 15th");
    expect(repeatValue(weekly, 4500)).toMatchObject({
      monthlyCents: 19500,
      yearlyCents: 234000,
      totalCents: 13500,
    });
  });
  it("moves a passed start date forward on the same weekday", () => {
    expect(rollForward(weekly, "2026-11-12").startOn).toBe("2026-11-17");
    expect(rollForward(weekly, "2026-11-01").startOn).toBe("2026-11-03");
  });
});

async function planFixture(label: string, repeat: Partial<Repeat> = {}) {
  const t = await seedTenant(label, { withStaff: true });
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const today = localDateKey(new Date(), "America/Chicago");
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: label, lastName: "TEST" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Fleet" }),
  );
  const job: JobInput = {
    customerId: c.id,
    vehicleId: v.id,
    title: "Weekly mow",
    repeat: {
      every: "week",
      startOn: addLocalDays(today, 1),
      until: { kind: "visits", count: 3 },
      billing: "per_visit",
      ...repeat,
    },
    parts: [],
    labor: [
      {
        description: "Mow and edge",
        estimatedHoursHundredths: 100,
        actualHoursHundredths: null,
        sellRateCents: 4500,
        costRateCents: 2000,
      },
      {
        description: "Hedge trim",
        estimatedHoursHundredths: 100,
        actualHoursHundredths: null,
        sellRateCents: 3000,
        costRateCents: 1000,
      },
    ],
  };
  const created = await run((tx) => createJob(tx, job));
  const saved = await run((tx) => getJob(tx, created.id));
  const e = await run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: created.id,
      expectedJobVersion: saved!.version,
      taxBps: 0,
      supplementReason: "",
      terms: "",
    }),
  );
  // The customer keeps mowing and declines the hedge trim.
  await signTestEstimate(e.path.split("/").pop()!, "Pat", ["labor-0"], meta());
  const visits = (planId: string) =>
    run((tx) =>
      tx
        .select()
        .from(appointment)
        .where(
          and(
            eq(appointment.businessId, t.businessId),
            eq(appointment.servicePlanId, planId),
          ),
        )
        .orderBy(appointment.planVisitOn),
    );
  return { t, run, jobId: created.id, today, visits };
}

describe("service plans", () => {
  it("one signature starts a plan; each finished visit is billed for the approved work", async () => {
    const f = await planFixture("Plan per visit");
    const flowBefore = (
      await f.run((tx) => loadJobWorkflows(tx, [f.jobId]))
    ).get(f.jobId)!;
    expect(flowBefore).toMatchObject({ stage: "ready", repeats: true });
    expect(flowBefore.latest!.estimate.snapshot.repeatSummary).toContain(
      "for 3 visits",
    );
    // Staff can start it; a second start is refused.
    const started = await withTenant(f.t.businessId, f.t.staff!.actor, (tx) =>
      startServicePlan(tx, meta(), { jobId: f.jobId }),
    );
    expect(started.visitsScheduled).toBe(3);
    await expect(
      f.run((tx) => startServicePlan(tx, meta(), { jobId: f.jobId })),
    ).rejects.toThrow(/already running/);
    const [first, second] = await f.visits(started.id);
    const done = await f.run((tx) =>
      setAppointmentStatus(tx, meta(), first.id, "completed"),
    );
    expect(done.billed).toMatchObject({ totalCents: 4500 });
    await expect(
      f.run((tx) => setAppointmentStatus(tx, meta(), first.id, "scheduled")),
    ).rejects.toThrow(/already on an invoice/);
    await f.run((tx) =>
      setAppointmentStatus(tx, meta(), second.id, "cancelled"),
    );
    const [plan] = await f.run((tx) =>
      listServicePlans(tx, { jobIds: [f.jobId] }),
    );
    expect(plan).toMatchObject({
      perVisitCents: 4500,
      done: 1,
      skipped: 1,
      unbilled: 0,
      billedCents: 4500,
    });
    expect(plan.next).toHaveLength(1);
    const flow = (await f.run((tx) => loadJobWorkflows(tx, [f.jobId]))).get(
      f.jobId,
    )!;
    expect(flow.stage).toBe("plan");
    expect(flow.currentInvoice).toBeNull();
    // Voiding the visit's invoice frees the visit to be billed again.
    await f.run((tx) => voidInvoice(tx, meta(), done.billed!.id, "TEST"));
    const again = await f.run((tx) => billPlanVisits(tx, meta(), plan.id));
    expect(again).toMatchObject({ totalCents: 4500 });
    expect(await f.run((tx) => recurringRevenue(tx))).toEqual({
      plans: 1,
      monthlyCents: 19500,
    });
  });

  it("monthly billing puts each finished visit on one itemized invoice", async () => {
    const f = await planFixture("Plan monthly", {
      billing: "monthly",
      until: { kind: "stopped" },
    });
    const plan = await f.run((tx) =>
      startServicePlan(tx, meta(), { jobId: f.jobId }),
    );
    const vs = await f.visits(plan.id);
    expect(vs.length).toBeGreaterThanOrEqual(8);
    for (const v of vs.slice(0, 2)) {
      const r = await f.run((tx) =>
        setAppointmentStatus(tx, meta(), v.id, "completed"),
      );
      expect(r.billed).toBeNull();
    }
    const bill = await f.run((tx) => billPlanVisits(tx, meta(), plan.id));
    expect(bill!.totalCents).toBe(9000);
    const [inv] = await f.run((tx) =>
      tx.select().from(invoice).where(eq(invoice.id, bill!.id)),
    );
    expect(inv.snapshot.lines.map((l) => l.id)).toEqual([
      `labor-0@${vs[0].planVisitOn}`,
      `labor-0@${vs[1].planVisitOn}`,
    ]);
    expect(inv.snapshot.title).toMatch(/2 visits/);
    expect(await f.run((tx) => billPlanVisits(tx, meta(), plan.id))).toBeNull();
    // The daily job finds this shop, adds nothing new and never double-bills.
    const daily = await runServicePlanMaintenance();
    expect(daily.businesses).toBeGreaterThanOrEqual(1);
    expect(daily.failed).toBe(0);
    await runServicePlanMaintenance();
    expect((await f.visits(plan.id)).length).toBe(vs.length);
  });

  it("pausing clears upcoming visits; resuming brings them back; ending is final", async () => {
    const f = await planFixture("Plan pause", { until: { kind: "stopped" } });
    const plan = await f.run((tx) =>
      startServicePlan(tx, meta(), { jobId: f.jobId }),
    );
    const before = (await f.visits(plan.id)).length;
    await expect(
      withTenant(f.t.businessId, f.t.staff!.actor, (tx) =>
        setServicePlanStatus(tx, meta(), { planId: plan.id, action: "end" }),
      ),
    ).resolves.toBeTruthy(); // domain allows; the action is owner-only
    const f2 = await planFixture("Plan pause 2", {
      until: { kind: "stopped" },
    });
    const p2 = await f2.run((tx) =>
      startServicePlan(tx, meta(), { jobId: f2.jobId }),
    );
    await f2.run((tx) =>
      setServicePlanStatus(tx, meta(), { planId: p2.id, action: "pause" }),
    );
    expect(await f2.visits(p2.id)).toHaveLength(0);
    await f2.run((tx) =>
      setServicePlanStatus(tx, meta(), { planId: p2.id, action: "resume" }),
    );
    expect((await f2.visits(p2.id)).length).toBe(before);
    await f2.run((tx) =>
      setServicePlanStatus(tx, meta(), {
        planId: p2.id,
        action: "end",
        reason: "Moved away",
      }),
    );
    await expect(
      f2.run((tx) =>
        setServicePlanStatus(tx, meta(), { planId: p2.id, action: "resume" }),
      ),
    ).rejects.toThrow(/already ended/);
    expect(
      (await f2.run((tx) => loadJobWorkflows(tx, [f2.jobId]))).get(f2.jobId)!
        .stage,
    ).toBe("plan_ended");
  });

  it("refuses to start a plan from a one-time job", async () => {
    const f = await planFixture("Plan one-time");
    const t = f.t;
    const c = await f.run((tx) =>
      createCustomer(tx, meta(), { firstName: "Once", lastName: "TEST" }),
    );
    const v = await f.run((tx) =>
      createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
    );
    const j = await f.run((tx) =>
      createJob(tx, {
        customerId: c.id,
        vehicleId: v.id,
        title: "One time",
        parts: [],
        labor: [
          {
            description: "Fix",
            estimatedHoursHundredths: 100,
            actualHoursHundredths: null,
            sellRateCents: 5000,
            costRateCents: null,
          },
        ],
      }),
    );
    const saved = await f.run((tx) => getJob(tx, j.id));
    const e = await f.run((tx) =>
      freezeEstimate(tx, meta(), {
        jobId: j.id,
        expectedJobVersion: saved!.version,
        taxBps: 0,
        supplementReason: "",
        terms: "",
      }),
    );
    await signTestEstimate(
      e.path.split("/").pop()!,
      "Pat",
      ["labor-0"],
      meta(),
    );
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) =>
        startServicePlan(tx, meta(), { jobId: j.id }),
      ),
    ).rejects.toThrow(/doesn’t repeat/);
  });
});
