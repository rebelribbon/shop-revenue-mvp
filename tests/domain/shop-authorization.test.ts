import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { shopAuthorizationTerms } from "@/db/schema";
import {
  activeShopAuthorization,
  enableShopAuthorization,
} from "@/domain/shop-authorization";
import { seedTenant, meta } from "../helpers/fixtures";

const body =
  "TEST ONLY: Owner-provided terms for customer review and individual work approval.";
it("requires an owner and explicit confirmation, with immutable version history", async () => {
  const t = await seedTenant("Shop terms", { withStaff: true });
  const run = <T>(f: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, f);
  await expect(
    run((tx) =>
      enableShopAuthorization(tx, meta(), { body, confirmed: false }),
    ),
  ).rejects.toThrow(/confirm/);
  await expect(
    withTenant(t.businessId, t.staff!.actor, (tx) =>
      enableShopAuthorization(tx, meta(), { body, confirmed: true }),
    ),
  ).rejects.toThrow(/owner/i);
  const first = await run((tx) =>
    enableShopAuthorization(tx, meta(), { body, confirmed: true }),
  );
  const repeated = await run((tx) =>
    enableShopAuthorization(tx, meta(), { body, confirmed: true }),
  );
  expect(repeated.id).toBe(first.id);
  const second = await run((tx) =>
    enableShopAuthorization(tx, meta(), {
      body: body + " Revised.",
      confirmed: true,
    }),
  );
  expect(second.version).toBe(first.version + 1);
  expect((await run(activeShopAuthorization))?.id).toBe(second.id);
  await expect(
    run((tx) =>
      tx
        .update(shopAuthorizationTerms)
        .set({ body: "Tampered" })
        .where(eq(shopAuthorizationTerms.id, first.id)),
    ),
  ).rejects.toThrow();
});

it("keeps one shop's authorization terms out of another shop's settings", async () => {
  const a = await seedTenant("Terms A"),
    b = await seedTenant("Terms B");
  const terms = await withTenant(a.businessId, a.owner.actor, (tx) =>
    enableShopAuthorization(tx, meta(), { body, confirmed: true }),
  );
  expect(
    await withTenant(b.businessId, b.owner.actor, (tx) =>
      tx
        .select()
        .from(shopAuthorizationTerms)
        .where(eq(shopAuthorizationTerms.id, terms.id)),
    ),
  ).toEqual([]);
});
