// Local seed (Section 23): two tenants, A and B, each with an active owner and
// staff login, plus internal users (two admins, one support). Uses the real
// domain functions and creates real local Supabase Auth users, so every M1
// flow can be signed into. Idempotent. Refuses to run against non-local Auth.
//
// Customers, vehicles, 18 months of sales, estimates and invoices belong to
// Milestone 2+ tables and are added to this script with them.
import { eq } from "drizzle-orm";
import { withAdmin } from "@/db/admin";
import { business, internalUser } from "@/db/schema";
import { closePools, resolveMemberships, withTenant } from "@/db/tenant";
import { createBusiness } from "@/domain/business";
import { acceptInvite, inviteStaff } from "@/domain/membership";
import { supabaseAdmin } from "@/server/auth/supabase";
import { loadEnv } from "../lib/env";

loadEnv();
const authHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname;
if (!["127.0.0.1", "localhost"].includes(authHost) || process.env.APP_ENV !== "local") {
  throw new Error("seed.ts only runs against the local Supabase stack");
}
const meta = { requestId: "seed" };
const auth = supabaseAdmin();

async function authUser(attrs: { email?: string; phone?: string }) {
  const created = await auth.auth.admin.createUser({ ...attrs, email_confirm: !!attrs.email, phone_confirm: !!attrs.phone });
  if (created.data.user) return created.data.user.id;
  const { data } = await auth.auth.admin.listUsers({ perPage: 1000 });
  const found = data.users.find((u) => (attrs.email && u.email === attrs.email) || (attrs.phone && `+${u.phone}` === attrs.phone));
  if (!found) throw new Error(`could not create or find auth user: ${created.error?.message}`);
  return found.id;
}

async function internal(email: string, displayName: string, role: "admin" | "support") {
  await authUser({ email });
  await withAdmin(null, async (tx) => {
    const [u] = await tx.select().from(internalUser).where(eq(internalUser.email, email));
    if (!u) await tx.insert(internalUser).values({ email, displayName, role });
  });
  const [u] = await withAdmin(null, (tx) => tx.select().from(internalUser).where(eq(internalUser.email, email)));
  return u;
}

async function tenant(label: "A" | "B", admin: { id: string }) {
  const legalName = `Shop ${label} Auto Repair LLC`;
  const [existing] = await withAdmin(null, (tx) => tx.select().from(business).where(eq(business.legalName, legalName)));
  if (existing) return existing.id;
  const owner = { email: `owner.${label.toLowerCase()}@shop-${label.toLowerCase()}.test`, name: `Owner ${label}` };
  const staff = { phone: label === "A" ? "+15125550101" : "+15125550202", name: `Staff ${label}` };
  const created = await createBusiness({ internalUserId: admin.id }, meta, {
    legalName,
    dba: `Shop ${label} Auto`,
    phoneE164: label === "A" ? "+15125550100" : "+15125550200",
    owner: { name: owner.name, email: owner.email },
  });
  const ownerAuth = await authUser({ email: owner.email });
  const o = await acceptInvite(meta, created.inviteToken, { authSubject: ownerAuth, email: owner.email, phoneE164: null, displayName: owner.name });
  const inv = await withTenant(created.businessId, { type: "user", id: o.userId, authSubject: ownerAuth }, (tx) =>
    inviteStaff(tx, meta, { name: staff.name, phoneE164: staff.phone }),
  );
  const staffAuth = await authUser({ phone: staff.phone });
  await acceptInvite(meta, inv.token, { authSubject: staffAuth, email: null, phoneE164: staff.phone, displayName: staff.name });
  const ms = await resolveMemberships(staffAuth);
  if (!ms.some((m) => m.businessId === created.businessId && m.status === "active")) throw new Error("staff membership not active");
  return created.businessId;
}

const admin1 = await internal("admin.one@example.test", "Avery Admin", "admin");
await internal("admin.two@example.test", "Blake Admin", "admin");
await internal("support.one@example.test", "Sam Support", "support");
const a = await tenant("A", admin1);
const b = await tenant("B", admin1);
await closePools();
console.log(
  [
    `seeded tenants A=${a} B=${b}`,
    "sign in (local): owner.a@shop-a.test / owner.b@shop-b.test by email link (Mailpit http://127.0.0.1:54324)",
    "staff: +1 512 555 0101 (A) / +1 512 555 0202 (B) by SMS code (dev inbox http://localhost:3000/dev/inbox)",
    "admin: admin.one@example.test, admin.two@example.test, support.one@example.test at /admin/sign-in",
  ].join("\n"),
);
