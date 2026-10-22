import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Every suite runs against real Postgres with the production roles, RLS and
// triggers (Section 22): a fresh database per run, bootstrapped and migrated.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global.ts"],
    setupFiles: ["tests/setup/env.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
