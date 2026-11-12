import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import {
  acceptInvite,
  canManageTeam,
  changeTeamAccess,
  inviteStaff,
} from "@/domain/membership";
import {
  createCustomer,
  getCustomerWithVehicles,
  listCustomers,
} from "@/domain/customers";
import { addTask, listTasks } from "@/domain/tasks";
import { assignCustomer } from "@/domain/assignments";
import { meta, seedTenant } from "../helpers/fixtures";

describe("Manager assignment and private advisor access", () => {
  it("keeps customer and manual task access private, including after reassignment", async () => {
    const shop = await seedTenant("AssignedAccess");
    const owner = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(shop.businessId, shop.owner.actor, fn);
    const invite = async (
      name: string,
      role: "staff" | "manager" | "technician",
    ) => {
      const email = `${name.toLowerCase()}-${randomUUID()}@shop.example.test`;
      const pending = await owner((tx) =>
        inviteStaff(tx, meta(), { name, email, role }),
      );
      const authSubject = randomUUID();
      const joined = await acceptInvite(meta(), pending.token, {
        authSubject,
        email,
        phoneE164: null,
        displayName: name,
      });
      const actor = { type: "user" as const, id: joined.userId, authSubject };
      return {
        id: joined.userId,
        run: <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
          withTenant(shop.businessId, actor, fn),
      };
    };
    const manager = await invite("Manager", "manager");
    const alice = await invite("Alice", "staff");
    const bob = await invite("Bob", "staff");
    expect(await manager.run((tx) => canManageTeam(tx))).toBe(true);
    expect(await alice.run((tx) => canManageTeam(tx))).toBe(false);
    await expect(
      alice.run((tx) =>
        inviteStaff(tx, meta(), {
          name: "Unauthorized",
          email: `no-${randomUUID()}@shop.example.test`,
          role: "staff",
        }),
      ),
    ).rejects.toThrow(/management/);

    const first = await owner((tx) =>
      createCustomer(tx, meta(), { firstName: "Private", lastName: "Alpha" }),
    );
    const second = await owner((tx) =>
      createCustomer(tx, meta(), { firstName: "Private", lastName: "Beta" }),
    );
    await manager.run((tx) =>
      assignCustomer(tx, meta(), { customerId: first.id, userId: alice.id }),
    );
    await manager.run((tx) =>
      assignCustomer(tx, meta(), { customerId: second.id, userId: bob.id }),
    );

    const aliceCustomers = await alice.run((tx) => listCustomers(tx));
    expect(aliceCustomers.map((c) => c.id)).toContain(first.id);
    expect(aliceCustomers.map((c) => c.id)).not.toContain(second.id);
    await expect(
      alice.run((tx) => getCustomerWithVehicles(tx, second.id)),
    ).rejects.toThrow();
    expect(
      (await bob.run((tx) => listCustomers(tx))).map((c) => c.id),
    ).toContain(second.id);

    const today = (await alice.run((tx) => listTasks(tx))).today;
    const manual = await alice.run((tx) =>
      addTask(tx, meta(), {
        title: "Call about brakes",
        dueOn: today,
        customerId: first.id,
      }),
    );
    await bob.run((tx) =>
      addTask(tx, meta(), {
        title: "Send estimate",
        dueOn: today,
        customerId: second.id,
      }),
    );
    const myTasks = await alice.run((tx) => listTasks(tx));
    expect(myTasks.due.some((t) => t.subjectId === manual.id)).toBe(true);
    expect(myTasks.due.some((t) => t.title === "Send estimate")).toBe(false);
    expect(
      (await manager.run((tx) => listTasks(tx))).due.some(
        (t) => t.title === "Send estimate",
      ),
    ).toBe(true);

    await manager.run((tx) =>
      assignCustomer(tx, meta(), { customerId: first.id, userId: bob.id }),
    );
    expect(
      (await alice.run((tx) => listCustomers(tx))).map((c) => c.id),
    ).not.toContain(first.id);
    await expect(
      alice.run((tx) => getCustomerWithVehicles(tx, first.id)),
    ).rejects.toThrow();
    expect(
      (await alice.run((tx) => listTasks(tx))).due.some(
        (t) => t.subjectId === manual.id,
      ),
    ).toBe(false);
    expect(
      (await bob.run((tx) => listTasks(tx))).due.some(
        (t) => t.subjectId === manual.id,
      ),
    ).toBe(true);
    await expect(
      manager.run((tx) =>
        changeTeamAccess(tx, meta(), {
          membershipId: "00000000-0000-4000-8000-000000000000",
          role: "manager",
        }),
      ),
    ).rejects.toThrow();
  });
});
