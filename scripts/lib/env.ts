import { existsSync } from "node:fs";

// Scripts read the same untracked .env.local the Next.js app uses locally, or
// the file named by ENV_FILE (for example .env.dev-hosted). In CI and hosted
// environments variables come from the environment itself.
export function loadEnv() {
  const file = process.env.ENV_FILE ?? ".env.local";
  if (existsSync(file)) process.loadEnvFile(file);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
