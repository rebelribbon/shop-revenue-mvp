import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { withGlobalWorker } from "@/db/tenant";
import { AppError } from "@/lib/errors";
export async function checkPublicThrottle(
  kind: "read" | "sign",
  token: string,
  ip: string | null | undefined,
) {
  const secret = process.env.SESSION_SIGNING_SECRET;
  if (!secret)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Customer documents are temporarily unavailable.",
    );
  const accepted = await withGlobalWorker(async (tx) => {
    let allowed = true;
    for (const scope of [
      { name: "ip", value: ip ?? "unknown", max: kind === "sign" ? 30 : 300 },
      { name: "token", value: token, max: kind === "sign" ? 10 : 1200 },
    ]) {
      const hash = createHmac("sha256", secret)
        .update(`document:${kind}:${scope.name}:${scope.value}`)
        .digest("hex");
      const r = await tx.execute(
        sql`INSERT INTO app.auth_rate_limit(key_hash,window_start,hits) VALUES(${hash},to_timestamp(floor(extract(epoch FROM now())/900)*900),1) ON CONFLICT(key_hash,window_start) DO UPDATE SET hits=app.auth_rate_limit.hits+1 RETURNING hits`,
      );
      if (Number(r.rows[0].hits) > scope.max) allowed = false;
    }
    return allowed;
  });
  if (!accepted)
    throw new AppError(
      "RATE_LIMITED",
      "Too many document requests. Try again in 15 minutes.",
    );
}
