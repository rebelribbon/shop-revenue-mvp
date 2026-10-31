// Local seed: two tenants, A and B, each with an active owner and staff login,
// plus internal users. Uses real domain functions and local Supabase Auth only.
import { eq, sql } from "drizzle-orm";
import { withAdmin } from "@/db/admin";
import { business, internalUser } from "@/db/schema";
import { closePools, resolveMemberships, withTenant } from "@/db/tenant";
import { createBusiness } from "@/domain/business";
import { acceptInvite, inviteStaff } from "@/domain/membership";
import { supabaseAdmin } from "@/server/auth/supabase";
import { loadEnv } from "../lib/env";

loadEnv();
const authHost = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid",
).hostname;
if (
  !["127.0.0.1", "localhost"].includes(authHost) ||
  process.env.APP_ENV !== "local"
)
  throw new Error("seed.ts only runs against the local Supabase stack");
const meta = { requestId: "seed" };
const auth = supabaseAdmin();
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "ShopRevenueLocal123!";

async function authUser(email: string) {
  const created = await auth.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (created.data.user) return created.data.user.id;
  const { data } = await auth.auth.admin.listUsers({ perPage: 1000 });
  const found = data.users.find((u) => u.email === email);
  if (!found)
    throw new Error(
      `could not create or find auth user: ${created.error?.message}`,
    );
  const updated = await auth.auth.admin.updateUserById(found.id, {
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (updated.error) throw updated.error;
  return found.id;
}

async function internal(
  email: string,
  displayName: string,
  role: "admin" | "support",
) {
  const authProviderId = await authUser(email);
  await withAdmin(null, async (tx) => {
    const [u] = await tx
      .select()
      .from(internalUser)
      .where(eq(internalUser.email, email));
    if (!u)
      await tx
        .insert(internalUser)
        .values({ email, displayName, role, authProviderId });
    else if (!u.authProviderId)
      await tx
        .update(internalUser)
        .set({ authProviderId })
        .where(eq(internalUser.id, u.id));
  });
  const [u] = await withAdmin(null, (tx) =>
    tx.select().from(internalUser).where(eq(internalUser.email, email)),
  );
  return u;
}

async function tenant(label: "A" | "B", admin: { id: string }) {
  const legalName = `Shop ${label} Auto Repair LLC`;
  const [existing] = await withAdmin(null, (tx) =>
    tx.select().from(business).where(eq(business.legalName, legalName)),
  );
  if (existing) return existing.id;
  const owner = {
    email: `owner.${label.toLowerCase()}@shop-${label.toLowerCase()}.test`,
    name: `Owner ${label}`,
  };
  const staff = {
    email: `staff.${label.toLowerCase()}@shop-${label.toLowerCase()}.test`,
    name: `Staff ${label}`,
  };
  const created = await createBusiness({ internalUserId: admin.id }, meta, {
    legalName,
    dba: `Shop ${label} Auto`,
    phoneE164: label === "A" ? "+15125550100" : "+15125550200",
    owner: { name: owner.name, email: owner.email },
  });
  const ownerAuth = await authUser(owner.email);
  const o = await acceptInvite(meta, created.inviteToken, {
    authSubject: ownerAuth,
    email: owner.email,
    phoneE164: null,
    displayName: owner.name,
  });
  const inv = await withTenant(
    created.businessId,
    { type: "user", id: o.userId, authSubject: ownerAuth },
    (tx) => inviteStaff(tx, meta, { name: staff.name, email: staff.email }),
  );
  const staffAuth = await authUser(staff.email);
  await acceptInvite(meta, inv.token, {
    authSubject: staffAuth,
    email: staff.email,
    phoneE164: null,
    displayName: staff.name,
  });
  const ms = await resolveMemberships(staffAuth);
  if (
    !ms.some(
      (m) => m.businessId === created.businessId && m.status === "active",
    )
  )
    throw new Error("staff membership not active");
  return created.businessId;
}

const admin1 = await internal("admin.one@example.test", "Avery Admin", "admin");
await internal("admin.two@example.test", "Blake Admin", "admin");
await internal("support.one@example.test", "Sam Support", "support");
await (
  await import("./test-authorization-policy")
).seedTestAuthorizationPolicy();
const a = await tenant("A", admin1);
const b = await tenant("B", admin1);
if (process.env.E2E_LARGE_CUSTOMER_FIXTURE === "true") {
  await withTenant(b, { type: "system", id: null }, (tx) =>
    tx.execute(
      sql`INSERT INTO app.customer(business_id,first_name,last_name,display_name) SELECT ${b},'Search Fixture',lpad(n::text,4,'0'),'Search Fixture '||lpad(n::text,4,'0') FROM generate_series(1,500) n WHERE NOT EXISTS(SELECT 1 FROM app.customer WHERE business_id=${b} AND first_name='Search Fixture')`,
    ),
  );
}
await closePools();
console.log(
  [
    `seeded tenants A=${a} B=${b}`,
    "local E2E auth uses email + password for owner, staff, admin and support users",
    "owner: owner.a@shop-a.test / owner.b@shop-b.test",
    "staff: staff.a@shop-a.test / staff.b@shop-b.test",
    "admin: admin.one@example.test, admin.two@example.test, support.one@example.test",
  ].join("\n"),
);
