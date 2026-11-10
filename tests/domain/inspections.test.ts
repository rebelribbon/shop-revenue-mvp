import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import {
  addInspectionToJob,
  getInspection,
  saveInspection,
} from "@/domain/inspections";
import { createJob, getJob, jobInput } from "@/domain/jobs";
import { meta, seedTenant } from "../helpers/fixtures";

describe("Digital inspections", () => {
  it("starts from the trade's checklist, saves marks, and turns needs-work into estimate lines once", async () => {
    const t = await seedTenant("Inspect");
    const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, t.owner.actor, fn);
    const c = await run((tx) =>
      createCustomer(tx, meta(), { firstName: "Insp", lastName: "TEST" }),
    );
    const v = await run((tx) =>
      createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
    );
    const job = await run((tx) =>
      createJob(tx, {
        customerId: c.id,
        vehicleId: v.id,
        title: "Inspection",
        parts: [],
        labor: [],
      }),
    );
    const blank = await run((tx) => getInspection(tx, job.id));
    expect(blank.saved).toBe(false);
    expect(blank.items.map((i) => i.label)).toContain("Brake fluid");
    expect(blank.items).toHaveLength(40);
    expect(blank.counts.unchecked).toBe(blank.items.length);

    const items = blank.items.map((i) =>
      i.key === "brake_fluid"
        ? {
            ...i,
            status: "fix" as const,
            note: "fluid has moisture",
            recommendedWork: "Brake fluid flush",
          }
        : i.key === "tire_tread"
          ? { ...i, status: "watch" as const, note: "4/32 tread" }
          : { ...i, status: "good" as const },
    );
    const saved = await run((tx) =>
      saveInspection(tx, meta(), { jobId: job.id, items }),
    );
    expect(saved.complete).toBe(true);
    const after = await run((tx) => getInspection(tx, job.id));
    expect(after.counts).toMatchObject({ fix: 1, watch: 1, unchecked: 0 });
    expect(after.pending.map((i) => i.key)).toEqual(["brake_fluid"]);

    expect(await run((tx) => addInspectionToJob(tx, meta(), job.id))).toEqual({
      added: 1,
    });
    const updated = jobInput.parse(
      (await run((tx) => getJob(tx, job.id)))!.data,
    );
    expect(updated.labor.map((l) => l.description)).toEqual([
      "Brake fluid flush",
    ]);
    // Added once: nothing pending now, and a second tap is refused.
    expect((await run((tx) => getInspection(tx, job.id))).pending).toEqual([]);
    await expect(
      run((tx) => addInspectionToJob(tx, meta(), job.id)),
    ).rejects.toThrow(/Needs work/);
  });
});
