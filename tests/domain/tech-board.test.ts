import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inviteStaff, acceptInvite } from "@/domain/membership";
import { withTenant } from "@/db/tenant";
import { createAppointment } from "@/domain/appointments";
import { assignJob, assignVisit, listTechs } from "@/domain/assignments";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob } from "@/domain/jobs";
import { myDay } from "@/domain/my-day";
import { loadPipeline } from "@/domain/pipeline";
import { addLocalDays, localDateKey, localDateTimeToUtc } from "@/lib/timezone";
import { meta, seedTenant } from "../helpers/fixtures";

describe("Tech board and My day", () => {
  it("puts each job and visit on one tech's day", async () => {
    const t = await seedTenant("Techs", { withStaff: true });
    const asOwner = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, t.owner.actor, fn);
    const techEmail=`tech-${randomUUID()}@shop.example.test`;
    const invite=await asOwner(tx=>inviteStaff(tx,meta(),{
      name:"Techs Technician",email:techEmail,role:"technician",
    }));
    const subject=randomUUID();
    const accepted=await acceptInvite(meta(),invite.token,{
      authSubject:subject,email:techEmail,phoneE164:null,
      displayName:"Techs Technician",
    });
    const staff={
      userId:accepted.userId,
      actor:{type:"user" as const,id:accepted.userId,authSubject:subject},
    };
    const asStaff = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, staff.actor, fn);

    const techs = await asOwner((tx) => listTechs(tx));
    expect(techs.map((x) => x.name).sort()).toEqual(["Techs Technician"]);

    const c = await asOwner((tx) =>
      createCustomer(tx, meta(), { firstName: "Bay", lastName: "TEST" }),
    );
    const v = await asOwner((tx) =>
      createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
    );
    const job = await asOwner((tx) =>
      createJob(tx, {
        customerId: c.id,
        vehicleId: v.id,
        title: "Diagnose noise",
        parts: [],
        labor: [],
      }),
    );
    const assigned = await asOwner((tx) =>
      assignJob(tx, meta(), { jobId: job.id, userId: staff.userId }),
    );
    expect(assigned.tech).toBe("Techs Technician");

    // The board knows who's on it.
    const board = await asOwner((tx) => loadPipeline(tx));
    expect(board.columns.estimate.find((x) => x.id === job.id)?.techId).toBe(
      staff.userId,
    );

    // A visit tomorrow, given to the tech; look at "tomorrow" as today.
    const tomorrow = addLocalDays(
      localDateKey(new Date(), "America/Chicago"),
      1,
    );
    const visit = await asOwner((tx) =>
      createAppointment(tx, meta(), {
        customerId: c.id,
        vehicleId: v.id,
        localStartsAt: `${tomorrow}T09:00`,
      }),
    );
    const then = localDateTimeToUtc(`${tomorrow}T12:00`, "America/Chicago");
    expect(
      (await asStaff((tx) => myDay(tx, staff.userId, then))).unassignedVisits,
    ).toBe(1);
    await asOwner((tx) =>
      assignVisit(tx, meta(), {
        appointmentId: visit.id,
        userId: staff.userId,
      }),
    );

    const day = await asStaff((tx) => myDay(tx, staff.userId, then));
    expect(day.jobs.map((j) => j.id)).toEqual([job.id]);
    expect(day.visits.map((x) => x.id)).toEqual([visit.id]);
    expect(day.unassignedVisits).toBe(0);

    // The owner's day is empty; taking the tech off empties theirs.
    const ownerDay = await asOwner((tx) => myDay(tx, t.owner.userId, then));
    expect(ownerDay.jobs).toEqual([]);
    expect(ownerDay.visits).toEqual([]);
    await asOwner((tx) =>
      assignJob(tx, meta(), { jobId: job.id, userId: null }),
    );
    expect((await asStaff((tx) => myDay(tx, staff.userId, then))).jobs).toEqual(
      [],
    );
  });

  it("only lets you pick someone on your team", async () => {
    const a = await seedTenant("TechA");
    const b = await seedTenant("TechB");
    const c = await withTenant(a.businessId, a.owner.actor, (tx) =>
      createCustomer(tx, meta(), { firstName: "Other", lastName: "TEST" }),
    );
    const v = await withTenant(a.businessId, a.owner.actor, (tx) =>
      createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
    );
    const job = await withTenant(a.businessId, a.owner.actor, (tx) =>
      createJob(tx, {
        customerId: c.id,
        vehicleId: v.id,
        title: "Job",
        parts: [],
        labor: [],
      }),
    );
    await expect(
      withTenant(a.businessId, a.owner.actor, (tx) =>
        assignJob(tx, meta(), { jobId: job.id, userId: b.owner.userId }),
      ),
    ).rejects.toThrow(/on your team/);
  });
});
