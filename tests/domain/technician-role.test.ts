import { startClock, stopClock } from "@/domain/job-profit";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { assignJob } from "@/domain/assignments";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob, getJob, listJobs } from "@/domain/jobs";
import {
  acceptInvite,
  assertOwner,
  currentMemberRole,
  inviteStaff,
  listTeam,
} from "@/domain/membership";
import { meta, seedTenant } from "../helpers/fixtures";

describe("Technician role", () => {
  it("invites a technician who sees only assigned jobs and isn't an owner", async () => {
    const t = await seedTenant("TechRole");
    const asOwner = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, t.owner.actor, fn);
    const email = `tech-${randomUUID()}@shop.example.test`;
    const inv = await asOwner((tx) =>
      inviteStaff(tx, meta(), { name: "Tess", email, role: "technician" }),
    );
    const authSubject = randomUUID();
    const joined = await acceptInvite(meta(), inv.token, {
      authSubject,
      email,
      phoneE164: null,
      displayName: "Tess",
    });
    expect(joined.role).toBe("technician");
    const tech = { type: "user" as const, id: joined.userId, authSubject };
    const asTech = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, tech, fn);
    expect(await asTech((tx) => currentMemberRole(tx))).toBe("technician");
    await expect(asTech((tx) => assertOwner(tx))).rejects.toThrow();
    expect(
      (await asOwner((tx) => listTeam(tx))).find(
        (m) => m.userId === joined.userId,
      )?.role,
    ).toBe("technician");

    const c = await asOwner((tx) =>
      createCustomer(tx, meta(), { firstName: "Job", lastName: "TEST" }),
    );
    const v = await asOwner((tx) =>
      createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
    );
    const mk = (title: string) =>
      asOwner((tx) =>
        createJob(tx, {
          customerId: c.id,
          vehicleId: v.id,
          title,
          parts: [],
          labor: [],
        }),
      );
    const mine = await mk("Assigned");
    const other = await mk("Not assigned");
    await asOwner((tx) =>
      assignJob(tx, meta(), { jobId: mine.id, userId: joined.userId }),
    );
    expect(
      (await asTech((tx) => listJobs(tx, "", joined.userId))).map(
        (j) => j.title,
      ),
    ).toEqual(["Assigned"]);
    // The domain applies the restriction even if a caller omits/forges filters.
    expect((await asTech((tx) => listJobs(tx))).map((j) => j.id)).toEqual([
      mine.id,
    ]);
    expect(
      (await asTech((tx) => listJobs(tx, "", t.owner.userId))).map((j) => j.id),
    ).toEqual([mine.id]);
    expect(await asTech((tx) => getJob(tx, other.id))).toBeNull();
    await expect(
      asTech((tx) => startClock(tx, meta(), other.id)),
    ).rejects.toThrow();
    await expect(
      asTech((tx) =>
        assignJob(tx, meta(), { jobId: other.id, userId: joined.userId }),
      ),
    ).rejects.toThrow(/front office/);
    await expect(
      asTech((tx) =>
        createJob(tx, {
          customerId: c.id,
          vehicleId: v.id,
          title: "Unauthorized",
          parts: [],
          labor: [],
        }),
      ),
    ).rejects.toThrow(/service advisor/);
    const assigned = (await asOwner((tx) => getJob(tx, mine.id)))!;
    await expect(
      asTech((tx) =>
        createJob(tx, {
          customerId: c.id,
          vehicleId: v.id,
          jobId: mine.id,
          expectedVersion: assigned.version,
          title: "Changed price",
          parts: [],
          labor: [],
        }),
      ),
    ).rejects.toThrow(/service advisor/);
    await asTech((tx) => startClock(tx, meta(), mine.id));
    await asTech((tx) => stopClock(tx, meta()));
    expect((await asOwner((tx) => listJobs(tx))).length).toBe(2);
  });

  it("technicians and staff share the 10 team logins", async () => {
    const t = await seedTenant("TechSeats");
    const invite = (i: number) =>
      withTenant(t.businessId, t.owner.actor, (tx) =>
        inviteStaff(tx, meta(), {
          name: `Person ${i}`,
          email: `seat-${i}-${randomUUID()}@shop.example.test`,
          role: i % 2 ? "technician" : "staff",
        }),
      );
    for (let i = 0; i < 10; i++) await invite(i);
    await expect(invite(10)).rejects.toThrow(/up to 10 team logins/);
  });

  it("only staff or technician can be invited", async () => {
    const t = await seedTenant("TechBad");
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) =>
        inviteStaff(tx, meta(), {
          name: "X",
          email: `x-${randomUUID()}@shop.example.test`,
          role: "owner" as never,
        }),
      ),
    ).rejects.toThrow(/staff or technician/);
  });
});
