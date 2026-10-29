import { defineConfig, devices } from "@playwright/test";

// Deployment-blocking E2E (Section 22). Milestone 1 covers #1 (sign in by email
// link; Staff cannot reach Owner-only actions) plus the M1 acceptance flows.
// Runs against the local stack: Supabase Auth + Mailpit + the dev inbox.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  // next dev compiles each route on first visit; production builds respond far faster.
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: { command: "pnpm dev", url: "http://localhost:3000/sign-in", reuseExistingServer: true, timeout: 120_000 },
});
