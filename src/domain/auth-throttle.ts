import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { withGlobalWorker } from "@/db/tenant";
import { AppError } from "@/lib/errors";
const RULES = {
  signup: { ip: 10, email: 3, minutes: 60 },
  sign_in: { ip: 100, email: 30, minutes: 15 },
  reset: { ip: 10, email: 3, minutes: 60 },
  invite: { ip: 10, email: 3, minutes: 60 },
} as const;
export async function checkAuthThrottle(
  kind: keyof typeof RULES,
  email: string,
  ip: string | null | undefined,
) {
  const secret = process.env.SESSION_SIGNING_SECRET;
  if (!secret)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Sign-in is unavailable right now.",
    );
  const rule = RULES[kind];
  const scopes = [
    { type: "email", value: email.trim().toLowerCase(), max: rule.email },
    { type: "ip", value: ip ?? "unknown", max: rule.ip },
  ];
  const accepted = await withGlobalWorker(async (tx) => {
    let allowed = true;
    for (const scope of scopes) {
      const hash = createHmac("sha256", secret)
        .update(`${kind}:${scope.type}:${scope.value}`)
        .digest("hex");
      const r =
        await tx.execute(sql`INSERT INTO app.auth_rate_limit(key_hash,window_start,hits)
    VALUES(${hash},to_timestamp(floor(extract(epoch FROM now())/${rule.minutes * 60})*${rule.minutes * 60}),1)
    ON CONFLICT(key_hash,window_start) DO UPDATE SET hits=app.auth_rate_limit.hits+1 RETURNING hits`);
      if (Number(r.rows[0].hits) > scope.max) allowed = false;
    }
    return allowed;
  });
  if (!accepted)
    throw new AppError(
      "RATE_LIMITED",
      "Too many attempts. Wait a while before trying again.",
    );
}
