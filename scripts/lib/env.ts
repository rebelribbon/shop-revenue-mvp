import { existsSync } from "node:fs";

// Scripts read the same untracked .env.local the Next.js app uses locally.
// In CI and hosted environments variables come from the environment itself.
export function loadEnv() {
  for (const file of [".env.local"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
