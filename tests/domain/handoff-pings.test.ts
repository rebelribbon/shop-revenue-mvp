import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { assignAdvisor, assignJob } from "@/domain/assignments";
import { createCustomer, createVehicle } from "@/domain/customers";
import {
  handoffPingsOn,
  prepareHandoffPing,
  sendHandoffPing,
  setHandoffPings,
} from "@/domain/handoff-pings";
import { getInspection, saveInspection } from "@/domain/inspections";
import { createJob } from "@/domain/jobs";
import { acceptInvite, inviteStaff } from "@/domain/membership";
import {
  MemoryEmailProvider,
  setEmailProviderForTests,
} from "@/providers/email";
import { meta, seedTenant } from "../helpers/fixtures";

const mail = new MemoryEmailProvider();
beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.EMAIL_FROM_ADDRESS = "test@example.test";
  setEmailProviderForTests(mail);
});
afterAll(() => setEmailProviderForTests(null));

// A shop with an owner, a staff advisor, a technician and one RO.
async function shop() {
  const t = await seedTenant("Ping", { withStaff: true });
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
    createCustomer(tx, meta(), {
      firstName: "Private",
      lastName: "Customer TEST",
      phoneE164: "+15125550199",
    }),
  );
  const v = await owner((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await owner((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brake noise",
      parts: [],
      labor: [],
    }),
  );
  return { t, owner, advisor, tech, techEmail, techId: joined.userId, job };
}

async function submitInspection(f: Awaited<ReturnType<typeof shop>>) {
  const inspection = await f.tech((tx) => getInspection(tx, f.job.id));
  return f.tech((tx) =>
    saveInspection(tx, meta(), {
      jobId: f.job.id,
      submit: true,
      assessment: {
        diagnosis: "Pads worn",
        bay: "Bay 1",
        vehiclePickedUp: true,
      },
      items: inspection.items.map((i) => ({ ...i, status: "good" as const })),
    }),
  );
}

describe("RO handoff email pings", () => {
  it("emails the technician on assignment and the advisor when the inspection is submitted", async () => {
    const f = await shop();
    await f.owner((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.staff!.userId }),
    );
    const assigned = await f.owner((tx) =>
      assignJob(tx, meta(), { jobId: f.job.id, userId: f.techId }),
    );
    expect(assigned.handoff).toBe(true);

    const toTech = await f.owner((tx) => prepareHandoffPing(tx, f.job.id));
    expect(toTech?.stage).toBe("inspect_vehicle");
    expect(toTech?.email.to).toBe(f.techEmail);
    expect(toTech?.email.subject).toMatch(
      /^Assigned to you: RO-[0-9A-F]+ · Brake noise$/,
    );
    expect(toTech?.email.text).toContain("Hi Tess,");
    expect(toTech?.email.text).toContain("Ping Staff put you on RO-");
    expect(toTech?.email.text).toContain(
      `Open it: http://localhost:3000/app/jobs?job=${f.job.id}`,
    );
    // No customer details in a team email.
    expect(toTech?.email.text).not.toMatch(/Private|Customer TEST|5550199/);
    expect(await sendHandoffPing(toTech)).toBe(true);
    expect(mail.sent.filter((m) => m.to === f.techEmail)).toHaveLength(1);

    // Assigning the same tech again hands nothing off.
    expect(
      (
        await f.owner((tx) =>
          assignJob(tx, meta(), { jobId: f.job.id, userId: f.techId }),
        )
      ).handoff,
    ).toBe(false);

    const submitted = await submitInspection(f);
    expect(submitted.advisorNotified).toBe(true);
    const toAdvisor = await f.tech((tx) => prepareHandoffPing(tx, f.job.id));
    expect(toAdvisor?.stage).toBe("build_estimate");
    expect(toAdvisor?.email.to).toBe(f.t.staff!.email);
    expect(toAdvisor?.email.subject).toMatch(
      /^Inspection done, build the estimate: RO-[0-9A-F]+ · Brake noise$/,
    );
    expect(toAdvisor?.email.text).toContain(
      "Tess Tech finished the inspection on RO-",
    );
    expect(toAdvisor?.email.text).toContain("The estimate is waiting on you");
  });

  it("pings a newly assigned advisor about a waiting estimate, but never the person who did it", async () => {
    const f = await shop();
    await f.owner((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.staff!.userId }),
    );
    await f.owner((tx) =>
      assignJob(tx, meta(), { jobId: f.job.id, userId: f.techId }),
    );
    await submitInspection(f);
    // Ordinary advisors cannot change assignments; only management can.
    await expect(f.advisor((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.owner.userId }),
    )).rejects.toThrow(/management/);
    // A manager can transfer to another advisor, and that person is pinged.
    await f.owner((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.owner.userId }),
    );
    const moved = await f.owner((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.staff!.userId }),
    );
    expect(moved.handoff).toBe(true);
    const toStaff = await f.owner((tx) => prepareHandoffPing(tx, f.job.id));
    expect(toStaff?.email.to).toBe(f.t.staff!.email);
    // The owner taking it back themselves gets no email about their own click.
    await f.owner((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.staff!.userId }),
    );
    await f.owner((tx) =>
      assignAdvisor(tx, meta(), { jobId: f.job.id, userId: f.t.owner.userId }),
    );
    expect(await f.owner((tx) => prepareHandoffPing(tx, f.job.id))).toBeNull();
  });

  it("stays quiet when the owner turns handoff emails off; only the owner can", async () => {
    const f = await shop();
    expect(await f.owner((tx) => handoffPingsOn(tx))).toBe(true);
    await expect(
      f.advisor((tx) => setHandoffPings(tx, meta(), false)),
    ).rejects.toThrow();
    await f.owner((tx) => setHandoffPings(tx, meta(), false));
    await f.owner((tx) =>
      assignJob(tx, meta(), { jobId: f.job.id, userId: f.techId }),
    );
    expect(await f.owner((tx) => prepareHandoffPing(tx, f.job.id))).toBeNull();
    expect(await sendHandoffPing(null)).toBe(false);
  });
});
