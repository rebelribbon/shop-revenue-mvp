import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requiredReleaseEvidence,
  releaseProfileChecks,
  productionRecoveryReady,
  releaseDecision,
  releaseConfiguration,
} from "../../src/lib/release-readiness.ts";
import { verifyProductionBackup } from "../../scripts/ci/verify-provider-backup.mjs";

const env = {
  SUPABASE_PROJECT_REF: "akwxgjxdhfylebsteyqi",
  SUPABASE_ACCESS_TOKEN: "fixture-token-do-not-log",
};
const at = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const daily = (hours, status = "COMPLETED") => ({
  pitr_enabled: false,
  backups: [{ inserted_at: at(hours), status }],
});
const fetcher = (data) => async () => ({
  ok: true,
  status: 200,
  json: async () => data,
});

const technical = (profile = "pilot", signup = "false") => [
  ...releaseConfiguration({}).map((check) => ({ ...check, ready: true })),
  ...[
    "stripe-account-activation",
    "subscription-catalog",
    "release-commit",
  ].map((key) => ({ key, ready: true, message: key })),
  ...releaseProfileChecks({
    RELEASE_PROFILE: profile,
    PUBLIC_SIGNUP_ENABLED: signup,
  }),
];

test("closed pilot deploys for verification while commercial keeps all review evidence", () => {
  const commercial = requiredReleaseEvidence();
  assert.equal(commercial.length, 7);
  assert.deepEqual(requiredReleaseEvidence("commercial"), commercial);
  assert.deepEqual(requiredReleaseEvidence("pilot"), []);
  assert.equal(
    productionRecoveryReady({
      mode: "pilot-provider-daily",
      providerBackupAt: at(-1),
    }),
    false,
  );
});

test("pilot deployment does not claim missing reviews passed or public launch ready", () => {
  const pending = requiredReleaseEvidence().map((key) => ({
    key,
    ready: false,
    message: key,
  }));
  const checks = [...technical(), ...pending];
  const result = releaseDecision("pilot", checks);
  assert.equal(result.deploymentReady, true);
  assert.equal(result.launchReady, false);
  assert.deepEqual(result.pendingEvidence, requiredReleaseEvidence());
  assert.equal(
    pending.every((check) => check.ready === false),
    true,
  );
  assert.equal(releaseDecision("commercial", checks).deploymentReady, false);
});

test("pilot still blocks missing technical configuration, open signup and unknown profiles", () => {
  for (const profile of ["pilot", "unknown"]) {
    const checks = releaseProfileChecks({
      RELEASE_PROFILE: profile,
      PUBLIC_SIGNUP_ENABLED: "true",
    });
    assert.equal(releaseDecision(profile, checks).deploymentReady, false);
  }
  assert.equal(
    releaseDecision("pilot", [
      { key: "production-payments", ready: false, message: "missing" },
    ]).deploymentReady,
    false,
  );
  assert.equal(releaseDecision("unknown", []).deploymentReady, false);
  const evidence = requiredReleaseEvidence().map((key) => ({
    key,
    ready: true,
    message: key,
  }));
  assert.equal(
    releaseDecision(
      "pilot",
      [...technical(), ...evidence].filter((check) => check.key !== "database"),
    ).deploymentReady,
    false,
  );
  assert.equal(releaseDecision("pilot", []).deploymentReady, false);
  assert.equal(
    releaseDecision("commercial", [...technical("commercial"), ...evidence])
      .launchReady,
    true,
  );
});

test("unknown profiles retain every commercial requirement and fail validation", () => {
  for (const profile of ["", "Pilot", "pilot ", "true", "unknown"]) {
    assert.deepEqual(
      requiredReleaseEvidence(profile),
      requiredReleaseEvidence(),
    );
    assert.equal(
      releaseProfileChecks({ RELEASE_PROFILE: profile })[0].ready,
      false,
    );
  }
});

test("pilot requires explicitly closed public signup; commercial remains the default", () => {
  for (const value of [undefined, "", "true", "0"]) {
    assert.equal(
      releaseProfileChecks({
        RELEASE_PROFILE: "pilot",
        PUBLIC_SIGNUP_ENABLED: value,
      }).every((c) => c.ready),
      false,
    );
  }
  assert.ok(
    releaseProfileChecks({
      RELEASE_PROFILE: "pilot",
      PUBLIC_SIGNUP_ENABLED: "false",
    }).every((c) => c.ready),
  );
  assert.ok(releaseProfileChecks({}).every((c) => c.ready));
});

test("daily backup verification uses a read-only request to the pinned production project", async () => {
  const calls = [];
  const result = await verifyProductionBackup(env, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => daily(-1) };
  });
  assert.equal(result.providerBackupVerified, true);
  assert.equal(result.recentDailyBackup, true);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.supabase.com/v1/projects/akwxgjxdhfylebsteyqi/database/backups",
  );
  assert.equal(calls[0].options.method ?? "GET", "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(
    JSON.stringify(result).includes(env.SUPABASE_ACCESS_TOKEN),
    false,
  );
});

test("future, stale, failed and missing daily backups cannot pass the provider gate", async () => {
  for (const data of [
    daily(1),
    daily(-27),
    daily(-1, "FAILED"),
    { backups: [] },
  ])
    await assert.rejects(
      () => verifyProductionBackup(env, fetcher(data)),
      /production migration blocked/,
    );
});

test("existing PITR restore points keep working without enabling or purchasing PITR", async () => {
  for (const hours of [-1, 1, -25]) {
    const data = {
      pitr_enabled: true,
      physical_backup_data: {
        latest_physical_backup_date_unix: Math.floor(
          (Date.now() + hours * 3600000) / 1000,
        ),
      },
    };
    if (hours === -1)
      assert.equal(
        (await verifyProductionBackup(env, fetcher(data))).recentRestorePoint,
        true,
      );
    else await assert.rejects(() => verifyProductionBackup(env, fetcher(data)));
  }
});

test("unexpected projects and missing credentials cannot issue provider requests", async () => {
  let calls = 0;
  const unexpected = async () => {
    calls++;
    throw new Error("unexpected network call");
  };
  await assert.rejects(() =>
    verifyProductionBackup(
      { ...env, SUPABASE_PROJECT_REF: "gcclcuvdrqqllolxqhok" },
      unexpected,
    ),
  );
  await assert.rejects(() =>
    verifyProductionBackup(
      { ...env, SUPABASE_ACCESS_TOKEN: undefined },
      unexpected,
    ),
  );
  assert.equal(calls, 0);
});

test("denied and failed provider reads suppress credentials and response bodies", async () => {
  for (const request of [
    async () => ({
      ok: false,
      status: 403,
      json: async () => ({ secret: env.SUPABASE_ACCESS_TOKEN }),
    }),
    async () => {
      throw new Error(env.SUPABASE_ACCESS_TOKEN);
    },
  ]) {
    await assert.rejects(
      () => verifyProductionBackup(env, request),
      (error) => {
        assert.match(error.message, /Provider backup lookup failed/);
        assert.equal(error.message.includes(env.SUPABASE_ACCESS_TOKEN), false);
        return true;
      },
    );
  }
});

test("both profiles keep automated restore, provider backup and exact-candidate promotion gates", () => {
  const deploy = readFileSync(
    new URL("../../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  const ci = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(deploy, /default: commercial/);
  assert.match(deploy, /--build-env RELEASE_PROFILE="\$RELEASE_PROFILE"/);
  assert.match(deploy, /--prod --skip-domain/);
  assert.match(
    ci,
    /Restore the complete application schema and verify isolation/,
  );
  const steps = [
    "run: node scripts/ci/verify-provider-backup.mjs",
    "- name: Build production candidate",
    "- name: Migrate production",
    "- name: Production smoke",
    "- name: Promote the tested production build",
  ];
  const positions = steps.map((step) => deploy.indexOf(step));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  );
});
