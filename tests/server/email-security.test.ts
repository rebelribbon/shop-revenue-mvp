import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import {
  issueEmailCode,
  consumeEmailCode,
  selectAuthenticator,
} from "@/domain/email-security";
const mocked = vi.hoisted(() => ({
  identity: { authSubject: "", email: "security@example.test" },
  sessionId: "",
  aal: "aal1",
  challengeFails: false,
  factorId: "",
  jar: new Map<string, { value: string; options: unknown }>(),
}));
vi.mock("@/server/request", () => ({
  getRequestMeta: async () => ({
    requestId: mocked.identity.authSubject,
    ip: null,
    userAgent: null,
  }),
}));
vi.mock("@/providers/email", () => ({
  emailProvider: () => ({ send: async () => ({ id: "security-test" }) }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => mocked.jar.get(key),
    set: (key: string, value: string, options: unknown) =>
      mocked.jar.set(key, { value, options }),
    delete: (key: string) => mocked.jar.delete(key),
  }),
}));
vi.mock("@/server/auth/session", async (original) => ({
  ...(await original<typeof import("@/server/auth/session")>()),
  getIdentity: async () => mocked.identity,
}));
vi.mock("@/server/auth/supabase", async (original) => ({
  ...(await original<typeof import("@/server/auth/supabase")>()),
  supabaseServer: async () => ({
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: mocked.identity.authSubject,
            session_id: mocked.sessionId,
          },
        },
        error: null,
      }),
      mfa: {
        listFactors: async () => ({
          data: {
            totp: [{ id: mocked.factorId }],
            all: [
              { id: mocked.factorId, factor_type: "totp", status: "verified" },
            ],
          },
          error: null,
        }),
        challengeAndVerify: async () => ({
          data: null,
          error: mocked.challengeFails ? new Error("Invalid code") : null,
        }),
        getAuthenticatorAssuranceLevel: async () => ({
          data: {
            currentLevel: mocked.aal,
            nextLevel: mocked.aal,
            currentAuthenticationMethods: ["password", "mfa/totp"],
          },
          error: null,
        }),
      },
    },
  }),
}));
import {
  grantPasswordStep,
  grantEmailStep,
  hasEmailStep,
  clearSecondStep,
  grantFreshAuthenticatorStep,
  hasFreshAuthenticatorStep,
  AUTHENTICATOR_STEP_COOKIE,
  EMAIL_STEP_COOKIE,
} from "@/server/auth/email-security";
import { sessionNeedsMfa } from "@/server/auth/assurance";
import { enrollAuthenticator, verifyAuthenticator } from "@/server/actions/mfa";
import { sendSecondStepCode } from "@/server/actions/email-security";
beforeEach(() => {
  mocked.jar.clear();
  mocked.identity.authSubject = randomUUID();
  mocked.sessionId = randomUUID();
  mocked.factorId = randomUUID();
  mocked.aal = "aal1";
  mocked.challengeFails = false;
});
it("allows replacing an authenticator after an actual fresh challenge even when provider AMR has no timestamps", async () => {
  await grantPasswordStep();
  await selectAuthenticator(mocked.identity.authSubject);
  mocked.aal = "aal2";
  expect(await sendSecondStepCode(true)).toMatchObject({ ok: false });
  expect(
    await verifyAuthenticator({ factorId: mocked.factorId, code: "123456" }),
  ).toMatchObject({ ok: true });
  expect(await hasFreshAuthenticatorStep(context())).toBe(true);
  // The signed freshness proof cannot substitute for the provider's AAL2.
  mocked.aal = "aal1";
  expect(await sendSecondStepCode(true)).toMatchObject({ ok: false });
  mocked.aal = "aal2";
  expect(await sendSecondStepCode(true)).toMatchObject({ ok: true });
});
it("does not grant authenticator freshness when the provider rejects the challenge", async () => {
  await selectAuthenticator(mocked.identity.authSubject);
  mocked.challengeFails = true;
  expect(
    await verifyAuthenticator({ factorId: mocked.factorId, code: "123456" }),
  ).toMatchObject({ ok: false });
  expect(await hasFreshAuthenticatorStep(context())).toBe(false);
});
it("binds authenticator freshness to the account, session and security version and clears it on sign-out", async () => {
  await selectAuthenticator(mocked.identity.authSubject);
  await grantFreshAuthenticatorStep();
  const c = context();
  expect(await hasFreshAuthenticatorStep(c)).toBe(true);
  expect(
    await hasFreshAuthenticatorStep({ ...c, sessionId: randomUUID() }),
  ).toBe(false);
  expect(
    await hasFreshAuthenticatorStep({ ...c, authSubject: randomUUID() }),
  ).toBe(false);
  const cookie = mocked.jar.get(AUTHENTICATOR_STEP_COOKIE)!;
  expect(cookie.options).toMatchObject({
    httpOnly: true,
    sameSite: "lax",
    maxAge: 300,
  });
  mocked.jar.set(AUTHENTICATOR_STEP_COOKIE, {
    ...cookie,
    value: cookie.value + "x",
  });
  expect(await hasFreshAuthenticatorStep(c)).toBe(false);
  mocked.jar.set(AUTHENTICATOR_STEP_COOKIE, cookie);
  await selectAuthenticator(c.authSubject);
  expect(await hasFreshAuthenticatorStep(c)).toBe(false);
  await grantFreshAuthenticatorStep();
  await clearSecondStep();
  expect(await hasFreshAuthenticatorStep(c)).toBe(false);
});
it("requires a new authenticator challenge after five minutes", async () => {
  await selectAuthenticator(mocked.identity.authSubject);
  await grantFreshAuthenticatorStep();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 301_000);
  try {
    expect(await hasFreshAuthenticatorStep(context())).toBe(false);
  } finally {
    clock.mockRestore();
  }
});
const context = () => ({ ...mocked.identity, sessionId: mocked.sessionId });
it("does not let a password-only session replace required email verification with its own authenticator", async () => {
  const c = context();
  const code = await issueEmailCode(c, false);
  await consumeEmailCode(c, code);
  await grantPasswordStep();
  expect(await enrollAuthenticator()).toMatchObject({
    ok: false,
    message: "Verify a fresh email code before changing to an authenticator.",
  });
  expect(
    await verifyAuthenticator({ factorId: randomUUID(), code: "123456" }),
  ).toMatchObject({
    ok: false,
    message: "Verify a fresh email code before changing to an authenticator.",
  });
});
it("requires both password and emailed proof and rejects copied, tampered or revoked cookies", async () => {
  const c = context();
  const code = await issueEmailCode(c, false);
  const version = (await consumeEmailCode(c, code))!;
  await grantEmailStep(c, version);
  expect(await hasEmailStep(c)).toBe(false);
  await grantPasswordStep();
  await grantEmailStep(c, version);
  expect(await hasEmailStep(c)).toBe(true);
  expect(mocked.jar.get(EMAIL_STEP_COOKIE)?.options).toMatchObject({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  expect(await hasEmailStep({ ...c, sessionId: randomUUID() })).toBe(false);
  expect(await hasEmailStep({ ...c, authSubject: randomUUID() })).toBe(false);
  const cookie = mocked.jar.get(EMAIL_STEP_COOKIE)!;
  mocked.jar.set(EMAIL_STEP_COOKIE, { ...cookie, value: cookie.value + "x" });
  expect(await hasEmailStep(c)).toBe(false);
  mocked.jar.set(EMAIL_STEP_COOKIE, cookie);
  await selectAuthenticator(c.authSubject);
  expect(await hasEmailStep(c)).toBe(false);
});
it("enforces email verification on hosted guards while keeping native MFA required for internal access", async () => {
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  try {
    expect(await sessionNeedsMfa()).toBe(true);
    const c = context();
    await grantPasswordStep();
    const code = await issueEmailCode(c, false);
    await grantEmailStep(c, (await consumeEmailCode(c, code))!);
    expect(await sessionNeedsMfa()).toBe(false);
    expect(await sessionNeedsMfa(false, false)).toBe(true);
    expect(await sessionNeedsMfa(true)).toBe(true);
    await clearSecondStep();
    expect(await sessionNeedsMfa()).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});
