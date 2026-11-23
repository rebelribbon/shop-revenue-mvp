import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  resetPlan,
  resetCounter,
} from "../../scripts/ci/reset-owner-signup-limit.mjs";

const email = "owner@example.test";
const environment = () => ({
  APP_ENV: "production",
  PUBLIC_SIGNUP_ENABLED: "false",
  PILOT_OWNER_SIGNUP_EMAILS: ` ${email.toUpperCase()} ,other@example.test`,
  RESET_OWNER_EMAIL_SHA256: createHash("sha256").update(email).digest("hex"),
  SESSION_SIGNING_SECRET: "test-only-session-secret",
  DATABASE_URL_WORKER:
    "postgresql://worker_user.akwxgjxdhfylebsteyqi:test-only-password@pooler.example.test/postgres",
});
test("selects exactly the approved owner and signup-email scope", () => {
  const env = environment(),
    plan = resetPlan(env);
  assert.equal(
    plan.keyHash,
    createHmac("sha256", env.SESSION_SIGNING_SECRET)
      .update(`signup:email:${email}`)
      .digest("hex"),
  );
  assert.ok(!JSON.stringify(plan).includes(email));
});
test("rejects wrong environment, recipient and database role before connecting", () => {
  for (const override of [
    { APP_ENV: "staging" },
    { PUBLIC_SIGNUP_ENABLED: "true" },
    { PILOT_OWNER_SIGNUP_EMAILS: "" },
    { RESET_OWNER_EMAIL_SHA256: "bad" },
    { SESSION_SIGNING_SECRET: "" },
    {
      DATABASE_URL_WORKER:
        "postgresql://admin_user.akwxgjxdhfylebsteyqi:unused@pooler.example.test/postgres",
    },
    {
      DATABASE_URL_WORKER:
        "postgresql://worker_user.wrong:unused@pooler.example.test/postgres",
    },
  ])
    assert.throws(() => resetPlan({ ...environment(), ...override }));
});
test("uses worker RLS context, limits UPDATE to one hash/current window and commits", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return sql.startsWith("SELECT current_user")
        ? { rows: [{ role: "worker_user" }] }
        : { rows: [{ hits: 0 }], rowCount: 1 };
    },
  };
  assert.deepEqual(await resetCounter(client, "expected-hash"), { changed: 1 });
  assert.equal(calls[0].sql, "BEGIN");
  assert.match(calls[2].sql, /set_config\('app.actor_type','system',true\)/);
  assert.match(
    calls[3].sql,
    /key_hash=\$1 AND window_start=date_trunc\('hour',now\(\)\)/,
  );
  assert.deepEqual(calls[3].params, ["expected-hash"]);
  assert.equal(calls.at(-1).sql, "COMMIT");
});
test("rejects an unexpected database identity without issuing UPDATE", async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [{ role: "postgres" }] };
    },
  };
  await assert.rejects(resetCounter(client, "hash"), /Worker role required/);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(calls.every((x) => !x.startsWith("UPDATE")));
});
test("production operation preserves reviewer/main gates and never promotes the private build", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/reset-owner-signup-limit.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /github.ref_protected/);
  assert.match(workflow, /test "\$REVIEWED_COMMIT" = "\$GITHUB_SHA"/);
  assert.match(workflow, /--prod --skip-domain/);
  assert.match(
    workflow,
    /cp package\.json pnpm-lock\.yaml pnpm-workspace\.yaml/,
  );
  assert.doesNotMatch(workflow, /vercel.*\bpromote\b|SET ROLE|TRUNCATE/);
});
