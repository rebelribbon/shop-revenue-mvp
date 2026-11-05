// The only module (with db/admin.ts) allowed to open database connections for
// tenant data (Section 9; enforced by the ESLint rule in eslint.config.mjs).
//
// Every unit of work runs inside withTenant(): one transaction that first runs
// SET LOCAL for the tenant and actor, so pooled connections never carry context
// forward. Outside withTenant, RLS returns zero rows from tenant tables.
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { AppError, isRetryableDatabaseError } from "@/lib/errors";
import * as schema from "./schema";

export type ActorType = "user" | "customer" | "system" | "support" | "internal";

export type Actor = {
  type: ActorType;
  // user.id for users, internal_user.id for internal/support, null for system/customer
  id: string | null;
  // Verified Supabase Auth subject of the signed-in person, when there is one.
  authSubject?: string | null;
  supportSessionId?: string | null;
};

type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type TenantTx = Tx & {
  readonly businessId: string;
  readonly actor: Actor;
};

export type RuntimeRole = "app" | "worker";

const pools = new Map<string, { pool: pg.Pool; db: Db }>();

function connectionFor(role: RuntimeRole | "admin") {
  const url = {
    app: process.env.DATABASE_URL_APP,
    worker: process.env.DATABASE_URL_WORKER,
    admin: process.env.DATABASE_URL_ADMIN,
  }[role];
  if (!url)
    throw new Error(`Database URL for the ${role} role is not configured`);
  let entry = pools.get(url);
  if (!entry) {
    const pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    });
    pool.on("error", () => {
      // Idle client errors are surfaced on the next checkout; never crash the process.
    });
    entry = { pool, db: drizzle(pool, { schema }) };
    pools.set(url, entry);
  }
  return entry;
}

// Shared by db/admin.ts; not exported from the package surface for app code.
export function dbForRole(role: RuntimeRole | "admin"): Db {
  return connectionFor(role).db;
}

// Queue maintenance uses the worker pool only; tenant data still uses withTenant.
export const maintenancePool = () => connectionFor("worker").pool;

// Tests only: the shared pool itself, to probe for context leaking across requests.
export const poolForRole = (role: RuntimeRole | "admin") =>
  connectionFor(role).pool;

export async function closePools() {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.pool.end()));
}

const defaultRole = (): RuntimeRole =>
  process.env.DB_RUNTIME_ROLE === "worker" ? "worker" : "app";

export type TxOptions = {
  role?: RuntimeRole | "admin";
  retries?: number;
  // View-as writes exactly one kind of row: its own audit events. This lifts the
  // READ ONLY transaction; restrictive RLS still rejects every other support write.
  supportAudit?: boolean;
};

// Opens a transaction, sets the context with set_config(..., is_local => true)
// (the parameterised form of SET LOCAL), then runs fn. Support view-as runs in a
// READ ONLY transaction, and restrictive RLS policies reject support writes too.
export async function runInContext<T>(
  businessId: string | null,
  actor: Actor,
  fn: (tx: Tx) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const db = dbForRole(opts.role ?? defaultRole());
  const readOnly = actor.type === "support" && !opts.supportAudit;
  const maxRetries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(
        async (tx) => {
          await tx.execute(sql`SELECT
            set_config('app.business_id', ${businessId ?? ""}, true),
            set_config('app.actor_type', ${actor.type}, true),
            set_config('app.actor_id', ${actor.id ?? ""}, true),
            set_config('app.auth_subject', ${actor.authSubject ?? ""}, true)`);
          return fn(tx);
        },
        readOnly ? { accessMode: "read only" } : undefined,
      );
    } catch (err) {
      if (attempt < maxRetries && isRetryableDatabaseError(err)) continue;
      if (attempt >= maxRetries && isRetryableDatabaseError(err)) {
        throw new AppError(
          "CONFLICT",
          "Someone else changed this at the same time. Please try again.",
        );
      }
      throw err;
    }
  }
}

export async function withTenant<T>(
  businessId: string,
  actor: Actor,
  fn: (tx: TenantTx) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  if (!businessId) throw new Error("withTenant requires a business id");
  return runInContext(
    businessId,
    actor,
    (tx) =>
      fn(Object.assign(Object.create(tx), { businessId, actor }) as TenantTx),
    opts,
  );
}

// Worker-only: global work with no tenant (webhook routing, cache). RLS still
// applies; tenant tables return nothing here.
export async function withGlobalWorker<T>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runInContext(null, { type: "system", id: null }, fn, {
    role: "worker",
  });
}

// ---------------------------------------------------------------------------
// SECURITY DEFINER resolvers: the only queries that run without tenant context.
// ---------------------------------------------------------------------------

export type MembershipRow = {
  userId: string;
  userStatus: string;
  membershipId: string;
  businessId: string;
  role: "owner" | "staff" | "technician";
  status: "invited" | "active" | "removed";
  businessStatus: string;
};

export async function resolveMemberships(
  authSubject: string,
): Promise<MembershipRow[]> {
  const { rows } = await connectionFor("app").pool.query(
    `SELECT user_id AS "userId", user_status AS "userStatus", membership_id AS "membershipId",
            business_id AS "businessId", role, status, business_status AS "businessStatus"
       FROM app.resolve_memberships($1)`,
    [authSubject],
  );
  return rows;
}

export type InviteRow = {
  membershipId: string;
  businessId: string;
  role: "owner" | "staff" | "technician";
  inviteEmail: string | null;
  invitePhoneE164: string | null;
  inviteExpiresAt: Date | null;
  businessName: string;
};

export async function resolveInvite(
  tokenHash: string,
): Promise<InviteRow | null> {
  const { rows } = await connectionFor("app").pool.query(
    `SELECT membership_id AS "membershipId", business_id AS "businessId", role, invite_email AS "inviteEmail",
            invite_phone_e164 AS "invitePhoneE164", invite_expires_at AS "inviteExpiresAt",
            business_name AS "businessName"
       FROM app.resolve_invite($1)`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function ingestWebhookEvent(input: {
  provider: "stripe" | "twilio" | "postmark";
  providerEventId: string;
  eventType: string;
  payload: unknown;
}): Promise<{ eventId: string; duplicate: boolean }> {
  const { rows } = await connectionFor("app").pool.query(
    `SELECT event_id AS "eventId", duplicate FROM app.ingest_webhook_event($1, $2, $3, $4)`,
    [
      input.provider,
      input.providerEventId,
      input.eventType,
      JSON.stringify(input.payload),
    ],
  );
  return rows[0];
}

// Liveness for the health route: one trivial query on the app role.
export async function pingDatabase(): Promise<void> {
  await connectionFor("app").pool.query("SELECT 1");
}
