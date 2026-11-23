// Protected operations job only: use the same worker role and RLS context as
// signup. Never accept raw SQL, modify credentials, or reset other rate limits.
import { createHash, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

export function resetPlan(env) {
  if (env.APP_ENV !== "production" || env.PUBLIC_SIGNUP_ENABLED !== "false")
    throw new Error("Reset requires the closed production pilot");
  const fingerprint = env.RESET_OWNER_EMAIL_SHA256;
  if (!/^[a-f0-9]{64}$/.test(fingerprint ?? ""))
    throw new Error("An exact owner fingerprint is required");
  const emails = [
    ...new Set(
      (env.PILOT_OWNER_SIGNUP_EMAILS ?? "")
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const approved = emails.filter(
    (email) => createHash("sha256").update(email).digest("hex") === fingerprint,
  );
  if (approved.length !== 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approved[0]))
    throw new Error("Requested owner is not approved for pilot signup");
  if (!env.SESSION_SIGNING_SECRET || !env.DATABASE_URL_WORKER)
    throw new Error("Worker configuration is missing");
  const database = new URL(env.DATABASE_URL_WORKER);
  if (
    decodeURIComponent(database.username).split(".")[0] !== "worker_user" ||
    !`${database.hostname} ${database.username}`.includes(
      "akwxgjxdhfylebsteyqi",
    )
  )
    throw new Error("Unexpected production worker database");
  return {
    connectionString: env.DATABASE_URL_WORKER,
    keyHash: createHmac("sha256", env.SESSION_SIGNING_SECRET)
      .update(`signup:email:${approved[0]}`)
      .digest("hex"),
  };
}

export async function resetCounter(client, keyHash) {
  await client.query("BEGIN");
  try {
    const role = await client.query("SELECT current_user AS role");
    if (role.rows[0]?.role !== "worker_user")
      throw new Error("Worker role required");
    await client.query(
      "SELECT set_config('app.business_id','',true),set_config('app.actor_type','system',true),set_config('app.actor_id','',true),set_config('app.auth_subject','',true),set_config('statement_timeout','5000',true)",
    );
    const result = await client.query(
      "UPDATE app.auth_rate_limit SET hits=0 WHERE key_hash=$1 AND window_start=date_trunc('hour',now()) RETURNING hits",
      [keyHash],
    );
    if (result.rowCount > 1) throw new Error("Unexpected counter scope");
    await client.query("COMMIT");
    return { changed: result.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const plan = resetPlan(process.env);
  const client = new pg.Client({
    connectionString: plan.connectionString,
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    const result = await resetCounter(client, plan.keyHash);
    // The private candidate contains no API/function. Never promote it.
    await mkdir("public", { recursive: true });
    await writeFile(
      "public/index.html",
      "<!doctype html><title>Maintenance complete</title><p>Maintenance complete.</p>",
    );
    console.log(`OWNER_SIGNUP_RESET_OK changed=${result.changed}`);
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "OWNER_SIGNUP_RESET_FAILED: no credentials or provider details are logged",
    );
    process.exitCode = 1;
  });
