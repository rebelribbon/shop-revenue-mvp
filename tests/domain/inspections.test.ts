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
import { and, eq } from "drizzle-orm";
import { activity } from "@/db/schema";

const assessment = {
  diagnosis: "Confirmed customer concern during assessment",
  bay: "Bay 2",
  vehiclePickedUp: true,
};

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
      saveInspection(tx, meta(), {
        jobId: job.id,
        items,
        assessment,
        submit: true,
      }),
    );
    expect(saved.complete).toBe(true);
    expect(saved.advisorNotified).toBe(false);
    const after = await run((tx) => getInspection(tx, job.id));
    expect(after.counts).toMatchObject({ fix: 1, watch: 1, unchecked: 0 });
    expect(after.assessment).toMatchObject(assessment);
    expect(after.assessment.pickedUpAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(after.pending.map((i) => i.key)).toEqual(["brake_fluid"]);
    await expect(
      run((tx) =>
        saveInspection(tx, meta(), { jobId: job.id, items, submit: false }),
      ),
    ).rejects.toThrow(/cannot be overwritten/);

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
    const [frozen] = await run((tx) =>
      tx
        .select({ data: activity.data })
        .from(activity)
        .where(
          and(
            eq(activity.subjectId, job.id),
            eq(activity.kind, "inspection.submitted"),
          ),
        ),
    );
    expect(
      (frozen.data as { items: { addedToJob: boolean }[] }).items.every(
        (item) => !item.addedToJob,
      ),
    ).toBe(true);
    await expect(
      run((tx) => addInspectionToJob(tx, meta(), job.id)),
    ).rejects.toThrow(/No inspection recommendations/);
  });

  it("rejects removed, duplicated and substituted checkpoints; saves a full draft without submitting", async () => {
    const tenant = await seedTenant("Inspection guards");
    const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(tenant.businessId, tenant.owner.actor, fn);
    const customer = await run((tx) =>
      createCustomer(tx, meta(), {
        firstName: "Inspection",
        lastName: "Guard",
      }),
    );
    const vehicle = await run((tx) =>
      createVehicle(tx, meta(), { customerId: customer.id, make: "Honda" }),
    );
    const job = await run((tx) =>
      createJob(tx, {
        customerId: customer.id,
        vehicleId: vehicle.id,
        title: "Inspect",
        parts: [],
        labor: [],
      }),
    );
    const blank = await run((tx) => getInspection(tx, job.id));
    const checked = blank.items.map((item) => ({
      ...item,
      status: "good" as const,
    }));
    await expect(
      run((tx) =>
        saveInspection(tx, meta(), {
          jobId: job.id,
          items: checked,
          submit: true,
        }),
      ),
    ).rejects.toThrow(/Confirm pickup/);
    for (const invalid of [
      checked.slice(1),
      [...checked.slice(1), checked[1]],
      checked.map((item, index) =>
        index === 0 ? { ...item, key: "invented" } : item,
      ),
    ]) {
      await expect(
        run((tx) =>
          saveInspection(tx, meta(), {
            jobId: job.id,
            items: invalid,
            assessment,
            submit: true,
          }),
        ),
      ).rejects.toThrow(/every checkpoint/);
    }
    await expect(
      run((tx) =>
        saveInspection(tx, meta(), {
          jobId: job.id,
          items: [],
          assessment,
          submit: true,
        }),
      ),
    ).rejects.toThrow();
    const drafted = await run((tx) =>
      saveInspection(tx, meta(), {
        jobId: job.id,
        items: checked.map((item, index) =>
          index === 0
            ? {
                ...item,
                label: "Forged label",
                addedToJob: true,
                measurements: { lf: "32" },
              }
            : item,
        ),
      }),
    );
    expect(drafted.complete).toBe(false);
    const saved = await run((tx) => getInspection(tx, job.id));
    expect(saved.items[0]).toMatchObject({
      label: blank.items[0].label,
      addedToJob: false,
      measurements: { lf: "32" },
    });
    await expect(
      run((tx) => addInspectionToJob(tx, meta(), job.id)),
    ).rejects.toThrow(/Submit the completed inspection/);
    await expect(
      run((tx) =>
        saveInspection(tx, meta(), {
          jobId: job.id,
          items: checked.map((item, index) =>
            index === 0 ? { ...item, status: "fix" as const } : item,
          ),
          assessment,
          submit: true,
        }),
      ),
    ).rejects.toThrow(/requires findings/);
  });
});
