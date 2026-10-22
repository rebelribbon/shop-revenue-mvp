import { defineConfig } from "drizzle-kit";

// Drizzle Kit generates table DDL; RLS, grants, triggers and SECURITY DEFINER
// functions are hand-written SQL in the same migration sequence (Section 24).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATION ?? "" },
  strict: true,
  verbose: true,
});
