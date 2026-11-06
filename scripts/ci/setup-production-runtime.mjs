// One-time initialization of the two currently unconfigured production logins.
// Passwords stay in this process and sensitive Vercel variables, never reports.
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const project = "akwxgjxdhfylebsteyqi";
const vercelProject = "prj_c3KFd0Yr6iufwUAuvLRdu30GE68o";
const vercelTeam = "team_ErajC90RgZfezuIaos4BoBjw";
const roles = [
  ["worker_user", "DATABASE_URL_WORKER"],
  ["admin_user", "DATABASE_URL_ADMIN"],
];
const blocked = (code) => new Error(code);

export function sourceUrl(env) {
  if (
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REF_PROTECTED !== "true" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    env.REVIEWED_COMMIT !== env.GITHUB_SHA ||
    env.INITIALIZE_UNUSED_ROLES !== "true"
  )
    throw blocked("REVIEWED_PROTECTED_MAIN_REQUIRED");
  let url;
  try {
    url = new URL(env.BACKUP_DATABASE_URL);
  } catch {
    throw blocked("PRODUCTION_DATABASE_URL_REQUIRED");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) ||
    decodeURIComponent(url.username) !== `postgres.${project}` ||
    !url.password ||
    url.hash
  )
    throw blocked("PRODUCTION_DATABASE_TARGET_MISMATCH");
  url.port = "5432";
  url.pathname = "/postgres";
  url.search = "?sslmode=require&uselibpqcompat=true";
  return url;
}

export function roleUrl(source, role, password) {
  if (
    !roles.some(([name]) => name === role) ||
    !/^[a-f0-9]{96}$/.test(password)
  )
    throw blocked("INVALID_ROLE_OR_PASSWORD");
  const url = new URL(source);
  url.username = `${role}.${project}`;
  url.password = password;
  url.port = "6543";
  return url.toString();
}

export function vercelApi(token, fetcher = fetch) {
  if (!token) throw blocked("VERCEL_TOKEN_REQUIRED");
  return async (method, suffix = "", body) => {
    if (!/^(?:\/[A-Za-z0-9_-]+)?$/.test(suffix))
      throw blocked("INVALID_ENVIRONMENT_ID");
    const version = method === "DELETE" ? "v9" : "v10";
    const url = new URL(
      `https://api.vercel.com/${version}/projects/${vercelProject}/env${suffix}`,
    );
    url.searchParams.set("teamId", vercelTeam);
    if (method === "GET") url.searchParams.set("decrypt", "false");
    if (method === "POST") url.searchParams.set("upsert", "false");
    try {
      const response = await fetcher(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw blocked("VERCEL_REQUEST_FAILED");
      if (method === "DELETE") return {};
      return await response.json();
    } catch {
      // Provider response/error text may contain a submitted credential.
      throw blocked("VERCEL_REQUEST_FAILED");
    }
  };
}

export async function initializeRuntime(env, api, makeClient) {
  const source = sourceUrl(env);
  const list = await api("GET");
  if (!Array.isArray(list.envs)) throw blocked("ENVIRONMENT_LIST_INVALID");
  const production = list.envs.filter((item) =>
    item.target?.includes("production"),
  );
  const configured = roles.filter(([, key]) =>
    production.some((item) => item.key === key),
  );
  if (configured.length === roles.length)
    return { status: "already-configured", changed: [] };
  if (configured.length) throw blocked("PARTIAL_CONFIGURATION_REQUIRES_REVIEW");
  const auth = production.find(
    (item) => item.key === "NEXT_PUBLIC_SUPABASE_URL",
  );
  if (auth?.value !== `https://${project}.supabase.co`)
    throw blocked("VERCEL_AUTH_TARGET_MISMATCH");

  const client = makeClient(source.toString());
  const operation = `initial-runtime-${randomUUID()}`;
  const created = [];
  const logins = [];
  let transaction = false;
  let commitStarted = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transaction = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SELECT pg_advisory_xact_lock(72519001)");
    const { rows } = await client.query(
      `SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
              rolcreaterole, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = ANY($1)`,
      [roles.map(([name]) => name)],
    );
    if (
      rows.length !== roles.length ||
      rows.some(
        (r) =>
          !r.rolcanlogin ||
          r.rolinherit ||
          r.rolsuper ||
          r.rolcreatedb ||
          r.rolcreaterole ||
          r.rolreplication ||
          r.rolbypassrls,
      )
    )
      throw blocked("RUNTIME_ROLE_ATTRIBUTES_UNSAFE");
    const membership = await client.query(
      `SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
        WHERE r.rolname = ANY($1)`,
      [roles.map(([name]) => name)],
    );
    const sessions = await client.query(
      "SELECT 1 FROM pg_stat_activity WHERE usename = ANY($1)",
      [roles.map(([name]) => name)],
    );
    if (membership.rows.length || sessions.rows.length)
      throw blocked("RUNTIME_ROLES_NOT_UNUSED_OR_ISOLATED");

    for (const [role, key] of roles) {
      const password = randomBytes(48).toString("hex");
      const connectionString = roleUrl(source, role, password);
      // Both interpolations are constrained to constants/hex above.
      await client.query(`ALTER ROLE ${role} PASSWORD '${password}'`);
      await api("POST", "", {
        key,
        value: connectionString,
        type: "sensitive",
        target: ["production"],
        comment: operation,
      });
      created.push(key);
      logins.push({ role, connectionString });
    }
    // Verify metadata only; sensitive values are never read back.
    const saved = await api("GET");
    for (const [, key] of roles) {
      const matches = saved.envs?.filter(
        (item) => item.key === key && item.target?.includes("production"),
      );
      if (
        matches?.length !== 1 ||
        matches[0].type !== "sensitive" ||
        matches[0].comment !== operation
      )
        throw blocked("SENSITIVE_STORAGE_VERIFICATION_FAILED");
    }
    commitStarted = true;
    await client.query("COMMIT");
    transaction = false;
    for (const { role, connectionString } of logins) {
      const login = makeClient(connectionString);
      try {
        await login.connect();
        const identity = await login.query("SELECT current_user AS role");
        if (identity.rows[0]?.role !== role)
          throw blocked("LOGIN_IDENTITY_MISMATCH");
      } finally {
        try {
          await login.end();
        } catch {}
      }
    }
    return { status: "initialized", changed: created };
  } catch {
    let cleanupOk = !commitStarted;
    if (transaction && !commitStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        cleanupOk = false;
      }
      // A timed-out POST can succeed remotely. Only remove variables bearing
      // this operation's unique comment; never delete someone else's change.
      try {
        const saved = await api("GET");
        if (!Array.isArray(saved.envs))
          throw blocked("ENVIRONMENT_LIST_INVALID");
        for (const item of saved.envs) {
          if (
            roles.some(([, key]) => item.key === key) &&
            item.comment === operation &&
            item.target?.length === 1 &&
            item.target[0] === "production"
          )
            await api("DELETE", `/${item.id}`);
        }
      } catch {
        cleanupOk = false;
      }
    }
    // Once COMMIT starts, its outcome can be unknown after a disconnect. Keep
    // both saved credentials for investigation instead of deleting valid ones.
    throw blocked(
      cleanupOk
        ? "INITIALIZATION_FAILED_ROLLED_BACK"
        : "INITIALIZATION_REQUIRES_MANUAL_REVIEW",
    );
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await initializeRuntime(
      process.env,
      vercelApi(process.env.VERCEL_TOKEN),
      (connectionString) =>
        new pg.Client({ connectionString, connectionTimeoutMillis: 15000 }),
    );
    console.log(JSON.stringify(result));
  } catch {
    // No raw errors, URLs, SQL, provider responses or generated values in CI.
    console.error(
      "::error::Runtime initialization blocked or failed. Inspect non-secret configuration and role state before retrying; no release was performed.",
    );
    process.exitCode = 1;
  }
}
