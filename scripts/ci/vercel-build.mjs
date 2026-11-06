import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Secret variables are available inside Vercel, but not through `vercel pull`.
// Keep the live provider checks here, before a production build can succeed.
export function vercelBuild(env = process.env, run = spawnSync) {
  const options = { env, stdio: "inherit" };
  if (env.VERCEL_ENV === "production" || env.APP_ENV === "production") {
    const commit = env.RELEASE_COMMIT;
    if (
      !/^[a-f0-9]{40}$/.test(commit ?? "") ||
      commit !== env.VERCEL_GIT_COMMIT_SHA
    ) {
      console.error("Production build requires the exact reviewed commit.");
      return 1;
    }
    const check = run(
      process.execPath,
      ["--import", "tsx", "scripts/ci/release-check.ts"],
      { ...options, env: { ...env, GITHUB_SHA: commit } },
    );
    if (check.status !== 0) return check.status ?? 1;
  }
  return run("pnpm", ["build"], options).status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = vercelBuild();
}
