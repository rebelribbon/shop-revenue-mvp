// Runs the M1 interleaved tenant test (1,000 requests) against a hosted
// Supabase project through its transaction-mode pooler (port 6543).
//   ENV_FILE=.env.dev-hosted pnpm exec tsx scripts/db/interleave-pooler.ts
// Seeds three clearly labeled test tenants (owner + staff each) per run.
import { like } from "drizzle-orm";
import { withAdmin } from "@/db/admin";
import { internalUser } from "@/db/schema";
import { closePools } from "@/db/tenant";
import { seedTenant } from "../../tests/helpers/fixtures";
import { runInterleaved } from "../../tests/helpers/interleave";
import { loadEnv, requireEnv } from "../lib/env";

loadEnv();
const appUrl = new URL(requireEnv("DATABASE_URL_APP"));
if (appUrl.port !== "6543")
  throw new Error(
    `DATABASE_URL_APP must use the transaction pooler port 6543, got ${appUrl.port}`,
  );
process.env.LOG_LEVEL = "silent";

const label = `PoolerTest${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}`;
const seeded = [];
for (const l of ["A", "B", "C"])
  seeded.push(await seedTenant(`${label}-${l}`, { withStaff: true }));
const tenants = seeded.flatMap((t) => [
  { businessId: t.businessId, actor: t.owner.actor },
  { businessId: t.businessId, actor: t.staff!.actor },
]);
const r = await runInterleaved(tenants, { requests: 1000, concurrency: 40 });
// The fixtures create placeholder internal admins to seed tenants; never leave them active.
const deactivated = await withAdmin(null, (tx) =>
  tx
    .update(internalUser)
    .set({ active: false })
    .where(like(internalUser.email, "%@internal.example.test"))
    .returning({ id: internalUser.id }),
);
await closePools();
console.error(`deactivated ${deactivated.length} placeholder internal users`);
console.log(
  JSON.stringify(
    {
      target: `${appUrl.hostname}:${appUrl.port} (transaction pooler)`,
      tenants: seeded.length,
      ...r,
      violations: r.violations.slice(0, 20),
      violationCount: r.violations.length,
    },
    null,
    2,
  ),
);
if (r.violations.length) process.exitCode = 1;
