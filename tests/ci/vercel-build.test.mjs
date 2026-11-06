import { test } from "node:test";
import assert from "node:assert/strict";
import { vercelBuild } from "../../scripts/ci/vercel-build.mjs";

const commit = "a".repeat(40);
const production = {
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_SHA: commit,
  RELEASE_COMMIT: commit,
};

test("production cannot build a missing, malformed or different reviewed commit", () => {
  for (const change of [
    { RELEASE_COMMIT: undefined },
    { RELEASE_COMMIT: "main" },
    { RELEASE_COMMIT: "b".repeat(40) },
    { VERCEL_GIT_COMMIT_SHA: undefined },
  ]) {
    let calls = 0;
    const code = vercelBuild({ ...production, ...change }, () => {
      calls++;
      return { status: 0 };
    });
    assert.equal(code, 1);
    assert.equal(calls, 0);
  }
});

test("a rejected or crashed release check prevents application build", () => {
  for (const status of [1, 2, null]) {
    let calls = 0;
    const code = vercelBuild(production, () => {
      calls++;
      return { status };
    });
    assert.notEqual(code, 0);
    assert.equal(calls, 1);
  }
});

test("a production app cannot skip checks when Vercel system variables are missing", () => {
  let calls = 0;
  assert.equal(
    vercelBuild({ APP_ENV: "production" }, () => {
      calls++;
      return { status: 0 };
    }),
    1,
  );
  assert.equal(calls, 0);
});

test("production checks use Vercel's environment and propagate build failures", () => {
  const env = { ...production, GITHUB_SHA: "stale-ci-value" };
  const calls = [];
  const code = vercelBuild(env, (command, args, options) => {
    calls.push({ command, args, env: options.env });
    return { status: calls.length === 1 ? 0 : 17 };
  });
  assert.equal(calls[0].env.GITHUB_SHA, commit);
  assert.deepEqual(calls[0].args, [
    "--import",
    "tsx",
    "scripts/ci/release-check.ts",
  ]);
  assert.equal(code, 17);
  assert.equal(env.GITHUB_SHA, "stale-ci-value");
});

test("preview builds require no production credentials or commercial evidence", () => {
  const calls = [];
  const env = { VERCEL_ENV: "preview" };
  assert.equal(
    vercelBuild(env, (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    }),
    0,
  );
  assert.deepEqual(calls, [{ command: "pnpm", args: ["build"] }]);
});
