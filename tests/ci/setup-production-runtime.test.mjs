import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sourceUrl,
  roleUrl,
  vercelApi,
  initializeRuntime,
} from "../../scripts/ci/setup-production-runtime.mjs";

const env = {
  GITHUB_REF: "refs/heads/main",
  GITHUB_REF_PROTECTED: "true",
  GITHUB_SHA: "a".repeat(40),
  REVIEWED_COMMIT: "a".repeat(40),
  INITIALIZE_UNUSED_ROLES: "true",
  BACKUP_DATABASE_URL:
    "postgresql://postgres.akwxgjxdhfylebsteyqi:fixture-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
};
const keys = ["DATABASE_URL_WORKER", "DATABASE_URL_ADMIN"];
function fixture(options = {}) {
  const variables = [
    {
      key: "NEXT_PUBLIC_SUPABASE_URL",
      target: ["production"],
      value: "https://akwxgjxdhfylebsteyqi.supabase.co",
    },
    ...(options.variables ?? []),
  ];
  const queries = [],
    calls = [],
    passwords = [],
    verified = [];
  let rolledBack = false;
  const api = async (method, suffix, body) => {
    calls.push({ method, suffix });
    if (method === "GET") return { envs: variables.map((v) => ({ ...v })) };
    if (method === "DELETE") {
      const i = variables.findIndex((v) => `/${v.id}` === suffix);
      if (i >= 0) variables.splice(i, 1);
      return {};
    }
    const value = { ...body, id: `env_${variables.length}` };
    passwords.push(new URL(body.value).password);
    variables.push(value);
    if (options.concurrentChange && body.key === keys[0])
      variables.push({
        id: "unrelated",
        key: keys[1],
        type: "sensitive",
        target: ["production"],
        comment: "someone-else",
      });
    if (options.failPost && body.key === keys[1]) throw new Error(body.value);
    return { created: value };
  };
  const client = {
    connect: async () => {},
    end: async () => {},
    query: async (sql) => {
      queries.push(sql);
      if (sql === "ROLLBACK") rolledBack = true;
      if (sql === "COMMIT" && options.failCommit)
        throw new Error("fixture-password");
      if (sql.includes("FROM pg_roles"))
        return {
          rows: ["worker_user", "admin_user"].map((rolname) => ({
            rolname,
            rolcanlogin: true,
            rolinherit: false,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: options.unsafe ?? false,
          })),
        };
      if (sql.includes("FROM pg_stat_activity"))
        return { rows: options.active ? [{}] : [] };
      if (sql.includes("FROM pg_auth_members"))
        return { rows: options.membership ? [{}] : [] };
      return { rows: [] };
    },
  };
  const makeClient = (url) => {
    const user = decodeURIComponent(new URL(url).username).split(".")[0];
    if (user === "postgres") return client;
    return {
      connect: async () => {
        verified.push(user);
      },
      query: async () => ({ rows: [{ role: user }] }),
      end: async () => {},
    };
  };
  return {
    variables,
    queries,
    calls,
    passwords,
    verified,
    api,
    makeClient,
    rolledBack: () => rolledBack,
  };
}

test("unreviewed, unprotected, staging and non-production database targets cannot mutate", async () => {
  for (const change of [
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF_PROTECTED: "false" },
    { REVIEWED_COMMIT: "b".repeat(40) },
    { INITIALIZE_UNUSED_ROLES: "false" },
    {
      BACKUP_DATABASE_URL: env.BACKUP_DATABASE_URL.replace(
        "akwxgjxdhfylebsteyqi",
        "gcclcuvdrqqllolxqhok",
      ),
    },
    {
      BACKUP_DATABASE_URL: env.BACKUP_DATABASE_URL.replace(
        "pooler.supabase.com",
        "example.test",
      ),
    },
  ]) {
    const f = fixture();
    await assert.rejects(() =>
      initializeRuntime({ ...env, ...change }, f.api, f.makeClient),
    );
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.queries, []);
  }
  assert.throws(() => roleUrl(sourceUrl(env), "app_user", "a".repeat(96)));
});
test("existing credentials are never overwritten or rotated, and partial setup blocks", async () => {
  const f = fixture({
    variables: keys.map((key) => ({ key, target: ["production"] })),
  });
  assert.equal(
    (await initializeRuntime(env, f.api, f.makeClient)).status,
    "already-configured",
  );
  assert.deepEqual(f.queries, []);
  const partial = fixture({
    variables: [{ key: keys[0], target: ["production"] }],
  });
  await assert.rejects(
    () => initializeRuntime(env, partial.api, partial.makeClient),
    /PARTIAL/,
  );
  assert.deepEqual(partial.queries, []);
});
test("unsafe attributes, memberships and active role sessions prevent password changes", async () => {
  for (const options of [
    { unsafe: true },
    { active: true },
    { membership: true },
  ]) {
    const f = fixture(options);
    await assert.rejects(() => initializeRuntime(env, f.api, f.makeClient));
    assert.equal(
      f.queries.some((sql) => sql.startsWith("ALTER ROLE")),
      false,
    );
    assert.equal(
      f.calls.some((c) => c.method === "POST"),
      false,
    );
    assert.equal(f.rolledBack(), true);
  }
});
test("initialization preserves other roles, stores sensitive production variables and verifies both logins", async () => {
  const f = fixture();
  const report = await initializeRuntime(env, f.api, f.makeClient);
  assert.deepEqual(report, { status: "initialized", changed: keys });
  assert.deepEqual(f.verified, ["worker_user", "admin_user"]);
  assert.equal(
    f.queries.filter((sql) => sql.startsWith("ALTER ROLE")).length,
    2,
  );
  assert.equal(
    f.queries.some((sql) =>
      /ALTER ROLE (app_user|migration_owner|postgres)|GRANT|BYPASSRLS|CREATE ROLE/.test(
        sql,
      ),
    ),
    false,
  );
  assert.ok(f.passwords.every((p) => /^[a-f0-9]{96}$/.test(p)));
  assert.notEqual(f.passwords[0], f.passwords[1]);
  for (const key of keys) {
    const saved = f.variables.find((v) => v.key === key);
    assert.equal(saved.type, "sensitive");
    assert.deepEqual(saved.target, ["production"]);
    const url = new URL(saved.value);
    assert.equal(url.port, "6543");
    assert.equal(url.searchParams.get("sslmode"), "require");
  }
  assert.ok(f.passwords.every((p) => !JSON.stringify(report).includes(p)));
});
test("failed or ambiguous remote writes roll back passwords and only remove this operation's variables", async () => {
  const f = fixture({ failPost: true, concurrentChange: true });
  let error;
  try {
    await initializeRuntime(env, f.api, f.makeClient);
  } catch (e) {
    error = e;
  }
  assert.match(error.message, /ROLLED_BACK/);
  assert.equal(f.rolledBack(), true);
  assert.equal(f.queries.includes("COMMIT"), false);
  assert.deepEqual(
    f.variables.filter((v) => keys.includes(v.key)).map((v) => v.id),
    ["unrelated"],
  );
  assert.ok(f.passwords.every((p) => !error.message.includes(p)));
});
test("unknown commit outcome preserves saved credentials for manual review", async () => {
  const f = fixture({ failCommit: true });
  await assert.rejects(
    () => initializeRuntime(env, f.api, f.makeClient),
    /MANUAL_REVIEW/,
  );
  assert.equal(
    f.calls.some((c) => c.method === "DELETE"),
    false,
  );
  assert.equal(f.variables.filter((v) => keys.includes(v.key)).length, 2);
});
test("Vercel requests are target-pinned, reject redirects, avoid upserts and suppress provider secrets", async () => {
  const api = vercelApi("fixture-token", async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.vercel.com");
    assert.equal(
      parsed.searchParams.get("teamId"),
      "team_ErajC90RgZfezuIaos4BoBjw",
    );
    assert.equal(parsed.searchParams.get("upsert"), "false");
    assert.equal(options.redirect, "error");
    return { ok: false, text: async () => "fixture-password" };
  });
  await assert.rejects(
    () => api("POST", "", {}),
    (error) => error.message === "VERCEL_REQUEST_FAILED",
  );
  await assert.rejects(() => api("DELETE", "/../../other"));
});
