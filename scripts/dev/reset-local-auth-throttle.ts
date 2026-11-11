// Each browser project tests real sign-in. Reset only the disposable local
// runner's attempt counters between projects, keeping production limits intact.
import pg from "pg";
import { loadEnv, requireEnv } from "../lib/env";

loadEnv();
const loopback = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(host);
if (process.env.APP_ENV !== "local")
  throw new Error("Auth counter reset requires the disposable local stack");
const auth = new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL"));
const database = new URL(requireEnv("DATABASE_URL_MIGRATION"));
if (!loopback(auth.hostname) || !loopback(database.hostname))
  throw new Error("Refusing auth counter reset outside loopback services");

const client = new pg.Client({ connectionString: database.toString() });
try {
  await client.connect();
  await client.query("TRUNCATE app.auth_rate_limit");
  process.stdout.write("Reset disposable local auth attempt counters\n");
} finally {
  await client.end();
}
