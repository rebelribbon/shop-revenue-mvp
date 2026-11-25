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
  jar: new Map<string, { value: string; options: unknown }>(),
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
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
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
  EMAIL_STEP_COOKIE,
} from "@/server/auth/email-security";
import { sessionNeedsMfa } from "@/server/auth/assurance";
beforeEach(() => {
  mocked.jar.clear();
  mocked.identity.authSubject = randomUUID();
  mocked.sessionId = randomUUID();
});
const context = () => ({ ...mocked.identity, sessionId: mocked.sessionId });
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
