import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { business, location, membership, auditEvent } from "@/db/schema";
import { withTenant, resolveMemberships } from "@/db/tenant";
import { enrollShop } from "@/domain/shop-signup";
import { rawClient, meta } from "../helpers/fixtures";

it("creates one shop under concurrent verified signup retries and scopes its ownership", async () => {
  const identity = {
    authSubject: randomUUID(),
    email: `signup-${randomUUID()}@example.test`,
    emailVerified: true,
  };
  const input = { shopName: "New shop", ownerName: "Sam Owner" };
  const rows = await Promise.all(
    Array.from({ length: 3 }, () => enrollShop(identity, input, meta())),
  );
  expect(new Set(rows.map((r) => r.businessId)).size).toBe(1);
  const [owned] = await resolveMemberships(identity.authSubject);
  expect(owned).toMatchObject({
    role: "owner",
    status: "active",
    businessStatus: "active",
    businessId: rows[0].businessId,
  });
  const actor = {
    type: "user" as const,
    id: owned.userId,
    authSubject: identity.authSubject,
  };
  await withTenant(rows[0].businessId, actor, async (tx) => {
    expect(await tx.select().from(location)).toHaveLength(1);
    expect(await tx.select().from(membership)).toHaveLength(1);
    expect(
      await tx
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.action, "business.self_registered")),
    ).toHaveLength(1);
  });
  const other = await enrollShop(
    {
      authSubject: randomUUID(),
      email: `other-${randomUUID()}@example.test`,
      emailVerified: true,
    },
    input,
    meta(),
  );
  expect(
    await withTenant(rows[0].businessId, actor, (tx) =>
      tx.select().from(business).where(eq(business.id, other.businessId)),
    ),
  ).toEqual([]);
});

it("rejects unverified signup and prevents removed owners from restarting with another trial shop", async () => {
  const identity = {
    authSubject: randomUUID(),
    email: `unverified-${randomUUID()}@example.test`,
    emailVerified: false,
  };
  await expect(
    enrollShop(identity, { shopName: "Hidden", ownerName: "Sam" }, meta()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const verified = { ...identity, emailVerified: true };
  const created = await enrollShop(
    verified,
    { shopName: "Real", ownerName: "Sam" },
    meta(),
  );
  const [owned] = await resolveMemberships(identity.authSubject);
  await withTenant(
    created.businessId,
    { type: "user", id: owned.userId, authSubject: identity.authSubject },
    (tx) =>
      tx
        .update(membership)
        .set({ status: "removed" })
        .where(
          and(
            eq(membership.userId, owned.userId),
            eq(membership.role, "owner"),
          ),
        ),
  );
  await expect(
    enrollShop(
      verified,
      { shopName: "Another trial", ownerName: "Sam" },
      meta(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("keeps the signup resolver unavailable to the app database role", async () => {
  const client = await rawClient("app");
  try {
    await expect(
      client.query("select * from app.signup_owner_business($1)", [
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await client.end();
  }
});
