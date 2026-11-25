import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withAdmin } from "@/db/admin";
import {
  issueEmailCode,
  consumeEmailCode,
  cancelEmailCode,
  selectAuthenticator,
  securityPreference,
} from "@/domain/email-security";
import { readOnboarding, saveOnboarding } from "@/domain/onboarding";
import { rawClient } from "../helpers/fixtures";

const context = () => ({
  authSubject: randomUUID(),
  sessionId: randomUUID(),
  email: "security@example.test",
});
it("binds codes to one identity and login session, consumes once under concurrency, and stores only a hash", async () => {
  const c = context();
  const code = await issueEmailCode(c, false);
  const row = await withAdmin(null, (tx) =>
    tx.execute(
      sql`select code_hash from app.email_second_step where auth_subject = ${c.authSubject}::uuid`,
    ),
  );
  expect(row.rows[0].code_hash).not.toBe(code);
  expect(
    await consumeEmailCode({ ...c, sessionId: randomUUID() }, code),
  ).toBeNull();
  expect(
    await consumeEmailCode({ ...c, authSubject: randomUUID() }, code),
  ).toBeNull();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => consumeEmailCode(c, code)),
  );
  expect(results.filter((x) => x !== null)).toEqual([1]);
  expect(await securityPreference(c.authSubject)).toEqual({
    method: "email",
    version: 1,
  });
});
it("locks after five wrong codes, expires old challenges, and restricts resend frequency", async () => {
  const c = context();
  const code = await issueEmailCode(c, false);
  await expect(issueEmailCode(c, false)).rejects.toMatchObject({
    code: "RATE_LIMITED",
  });
  for (let i = 0; i < 5; i++)
    expect(
      await consumeEmailCode(c, code === "000000" ? "111111" : "000000"),
    ).toBeNull();
  expect(await consumeEmailCode(c, code)).toBeNull();
  await withAdmin(null, (tx) =>
    tx.execute(
      sql`update app.email_second_step set created_at = now() - interval '2 minutes' where auth_subject = ${c.authSubject}::uuid`,
    ),
  );
  const replacement = await issueEmailCode(c, false);
  await withAdmin(null, (tx) =>
    tx.execute(
      sql`update app.email_second_step set expires_at = now() - interval '1 second' where auth_subject = ${c.authSubject}::uuid`,
    ),
  );
  expect(await consumeEmailCode(c, replacement)).toBeNull();
});
it("revokes previous email verification when changing methods and prevents old challenge downgrade", async () => {
  const c = context();
  const code = await issueEmailCode(c, false);
  await selectAuthenticator(c.authSubject);
  expect(await consumeEmailCode(c, code)).toBeNull();
  expect(await securityPreference(c.authSubject)).toMatchObject({
    method: "authenticator",
  });
  const change = await issueEmailCode(c, true);
  expect(await consumeEmailCode(c, change)).toBe(2);
  await selectAuthenticator(c.authSubject);
  expect(await securityPreference(c.authSubject)).toEqual({
    method: "authenticator",
    version: 3,
  });
});
it("deletes undeliverable challenges and hides all account state from tenant and worker database roles", async () => {
  const c = context();
  const code = await issueEmailCode(c, false);
  await cancelEmailCode(c);
  expect(await consumeEmailCode(c, code)).toBeNull();
  for (const role of ["app", "worker"] as const) {
    const client = await rawClient(role);
    try {
      for (const table of [
        "account_security",
        "email_second_step",
        "onboarding_progress",
      ])
        await expect(
          client.query(`select * from app.${table}`),
        ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.end();
    }
  }
});
it("resumes setup per account and rejects simultaneous stale-device updates", async () => {
  const subject = randomUUID();
  expect((await readOnboarding(subject)).step).toBe(1);
  await saveOnboarding(subject, {
    step: 2,
    version: 0,
    draft: { businessType: "hvac", shopName: "Cooling Shop", ownerName: "Sam" },
  });
  expect((await readOnboarding(subject)).draft.businessType).toBe("hvac");
  expect((await readOnboarding(randomUUID())).draft).toEqual({});
  const results = await Promise.allSettled([
    saveOnboarding(subject, { step: 3, version: 1 }),
    saveOnboarding(subject, { step: 3, version: 1 }),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect((await readOnboarding(subject)).version).toBe(2);
});
