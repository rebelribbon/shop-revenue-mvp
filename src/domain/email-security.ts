import { createHmac, randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { withAdmin } from "@/db/admin";
import { AppError } from "@/lib/errors";
import { safeEqual } from "@/lib/tokens";

export type SecurityContext = {
  authSubject: string;
  sessionId: string;
  email: string;
};
export type SecurityPreference = {
  method: "email" | "authenticator" | null;
  version: number;
};
export const EMAIL_CODE_SECONDS = 600;
export const SECOND_STEP_SECONDS = 12 * 60 * 60;
const digest = (context: SecurityContext, code: string) => {
  const key = process.env.SESSION_SIGNING_SECRET;
  if (!key)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Security verification is unavailable.",
    );
  return createHmac("sha256", key)
    .update(
      JSON.stringify([
        "email-second-step",
        context.authSubject,
        context.sessionId,
        code,
      ]),
    )
    .digest("hex");
};

export async function securityPreference(
  authSubject: string,
): Promise<SecurityPreference> {
  return withAdmin(null, async (tx) => {
    const result = await tx.execute(
      sql`select method, version from app.account_security where auth_subject = ${authSubject}::uuid`,
    );
    return {
      method: (result.rows[0]?.method as SecurityPreference["method"]) ?? null,
      version: Number(result.rows[0]?.version ?? 0),
    };
  });
}

// Only the server-verified identity and session can choose a recipient. Codes
// are never stored in plaintext, returned to the browser, or written to logs.
export async function issueEmailCode(
  context: SecurityContext,
  changeMethod: boolean,
) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await withAdmin(null, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"security:" + context.authSubject}, 0))`,
    );
    const recent = await tx.execute(
      sql`select 1 from app.email_second_step where auth_subject = ${context.authSubject}::uuid and created_at > now() - interval '60 seconds' limit 1`,
    );
    if (recent.rows.length)
      throw new AppError(
        "RATE_LIMITED",
        "Wait one minute before requesting another code.",
      );
    await tx.execute(
      sql`delete from app.email_second_step where auth_subject = ${context.authSubject}::uuid and session_id = ${context.sessionId}::uuid`,
    );
    await tx.execute(
      sql`insert into app.email_second_step(auth_subject, session_id, code_hash, change_method, expires_at) values (${context.authSubject}::uuid, ${context.sessionId}::uuid, ${digest(context, code)}, ${changeMethod}, now() + interval '10 minutes')`,
    );
  });
  return code;
}

export async function cancelEmailCode(context: SecurityContext) {
  await withAdmin(null, (tx) =>
    tx.execute(
      sql`delete from app.email_second_step where auth_subject = ${context.authSubject}::uuid and session_id = ${context.sessionId}::uuid`,
    ),
  );
}

// Lock before checking: concurrent submits cannot reuse a code, and failed
// attempts commit instead of rolling back the counter with an exception.
export async function consumeEmailCode(
  context: SecurityContext,
  code: string,
): Promise<number | null> {
  return withAdmin(null, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"security:" + context.authSubject}, 0))`,
    );
    const result = await tx.execute(
      sql`select code_hash, attempts, change_method, expires_at, consumed_at from app.email_second_step where auth_subject = ${context.authSubject}::uuid and session_id = ${context.sessionId}::uuid for update`,
    );
    const row = result.rows[0];
    if (
      !row ||
      row.consumed_at ||
      Number(row.attempts) >= 5 ||
      new Date(String(row.expires_at)).getTime() <= Date.now()
    )
      return null;
    await tx.execute(
      sql`update app.email_second_step set attempts = attempts + 1 where auth_subject = ${context.authSubject}::uuid and session_id = ${context.sessionId}::uuid`,
    );
    if (
      !/^\d{6}$/.test(code) ||
      !safeEqual(digest(context, code), String(row.code_hash))
    )
      return null;
    const preference = await tx.execute(
      sql`select method, version from app.account_security where auth_subject = ${context.authSubject}::uuid`,
    );
    if (preference.rows[0]?.method === "authenticator" && !row.change_method)
      return null;
    await tx.execute(
      sql`update app.email_second_step set consumed_at = now() where auth_subject = ${context.authSubject}::uuid and session_id = ${context.sessionId}::uuid`,
    );
    const changed = await tx.execute(
      sql`insert into app.account_security(auth_subject, method, version) values (${context.authSubject}::uuid, 'email', 1) on conflict (auth_subject) do update set method = 'email', version = case when app.account_security.method = 'email' then app.account_security.version else app.account_security.version + 1 end, updated_at = now() returning version`,
    );
    return Number(changed.rows[0].version);
  });
}

export async function selectAuthenticator(authSubject: string) {
  await withAdmin(null, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"security:" + authSubject}, 0))`,
    );
    await tx.execute(
      sql`insert into app.account_security(auth_subject, method, version) values (${authSubject}::uuid, 'authenticator', 1) on conflict (auth_subject) do update set method = 'authenticator', version = app.account_security.version + 1, updated_at = now()`,
    );
    await tx.execute(
      sql`delete from app.email_second_step where auth_subject = ${authSubject}::uuid`,
    );
  });
}
