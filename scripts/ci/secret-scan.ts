import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const failures: { path: string; line: number; kind: string }[] = [];
for (const path of paths) {
  if (/\.(pdf|png|jpg|zip|ttf|woff2?)$/.test(path) || path === "pnpm-lock.yaml")
    continue;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const [i, line] of text.split("\n").entries()) {
    for (const [kind, pattern] of [
      ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ["stripe-secret", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/],
      ["cloud-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
      [
        "database-password",
        /postgres(?:ql)?:\/\/[^\s:@]+:([^\s@]{12,})@[^\s]+\.(?:supabase|com)/,
      ],
    ] as const) {
      if (
        pattern.test(line) &&
        !/(?:synthetic|fixture|placeholder|example|not-real)/i.test(line)
      )
        failures.push({ path, line: i + 1, kind });
    }
    for (const match of line.matchAll(
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}/g,
    )) {
      try {
        if (
          JSON.parse(
            Buffer.from(match[0].split(".")[1], "base64url").toString(),
          ).role === "service_role"
        )
          failures.push({ path, line: i + 1, kind: "service-role-jwt" });
      } catch {}
    }
  }
}
if (failures.length) {
  console.error(
    JSON.stringify({ secretScan: "failed", findings: failures }, null, 2),
  );
  process.exitCode = 1;
} else
  console.log(
    "Secret scan passed: no matching credentials in tracked text files.",
  );
