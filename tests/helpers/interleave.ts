// M1 risk mitigation (Section 26): "RLS with pooled connections (mitigated by
// SET LOCAL in every transaction and a test that runs 1,000 interleaved requests
// across tenants)". Runs N requests with high concurrency over a small pool so
// server connections are constantly reused across tenants. Every tenant request
// must see exactly its own data and write only into itself; every request
// without context must see nothing. Against Supabase's transaction pooler
// (port 6543) server connections are additionally shared between clients.
import { randomUUID } from "node:crypto";
import { dbForRole, withTenant, type Actor } from "@/db/tenant";
import { audit } from "@/domain/records";
import { clientOf } from "./fixtures";

export type InterleaveTenant = { businessId: string; actor: Actor };
export type InterleaveResult = {
  requests: number;
  tenantRequests: number;
  noContextRequests: number;
  violations: string[];
  ms: number;
};

export async function runInterleaved(
  tenants: InterleaveTenant[],
  opts: { requests?: number; concurrency?: number; noContextQuery?: () => Promise<number> } = {},
): Promise<InterleaveResult> {
  const total = opts.requests ?? 1000;
  const concurrency = opts.concurrency ?? 50;
  const violations: string[] = [];
  let tenantRequests = 0;
  let noContextRequests = 0;
  let next = 0;
  const started = Date.now();

  const noContext =
    opts.noContextQuery ??
    (async () => {
      // Same pool as the tenant requests: a context that leaked onto a pooled
      // connection would show up here as visible rows.
      const { rows } = await dbForRole("app").$client.query(
        "SELECT (SELECT count(*) FROM app.business) + (SELECT count(*) FROM app.membership) + (SELECT count(*) FROM app.audit_event) AS n",
      );
      return Number(rows[0].n);
    });

  async function one(i: number) {
    // Every 10th request runs without tenant context.
    if (i % 10 === 9) {
      noContextRequests++;
      const n = await noContext();
      if (n !== 0) violations.push(`request ${i}: query without tenant context saw ${n} rows`);
      return;
    }
    tenantRequests++;
    const t = tenants[i % tenants.length];
    const marker = randomUUID();
    await withTenant(t.businessId, t.actor, async (tx) => {
      const c = clientOf(tx);
      const ctx = (await c.query("SELECT current_setting('app.business_id', true) AS b")).rows[0].b;
      if (ctx !== t.businessId) violations.push(`request ${i}: context ${ctx} != ${t.businessId}`);
      await audit(tx, { requestId: `interleave-${i}` }, { action: "test.interleave", targetType: "test", targetId: marker });
      // Yield inside the transaction so other requests interleave on other connections.
      await new Promise((r) => setTimeout(r, Math.random() * 3));
      const biz = (await c.query("SELECT id FROM app.business")).rows.map((r) => r.id);
      if (biz.length !== 1 || biz[0] !== t.businessId) violations.push(`request ${i}: saw businesses ${biz.join(",")}`);
      const foreign = (await c.query("SELECT count(*)::int n FROM app.audit_event WHERE business_id <> $1", [t.businessId])).rows[0].n;
      if (foreign !== 0) violations.push(`request ${i}: saw ${foreign} foreign audit rows`);
      const mine = (await c.query("SELECT business_id FROM app.audit_event WHERE target_id = $1", [marker])).rows;
      if (mine.length !== 1 || mine[0].business_id !== t.businessId) violations.push(`request ${i}: own write not visible exactly once`);
      const members = (await c.query("SELECT DISTINCT business_id FROM app.membership")).rows.map((r) => r.business_id);
      if (members.some((b) => b !== t.businessId)) violations.push(`request ${i}: saw foreign memberships`);
    });
  }

  async function lane() {
    while (next < total) {
      const i = next++;
      try {
        await one(i);
      } catch (e) {
        violations.push(`request ${i}: error ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  return { requests: total, tenantRequests, noContextRequests, violations, ms: Date.now() - started };
}
