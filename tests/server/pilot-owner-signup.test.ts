import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  throttle: vi.fn(),
  send: vi.fn(),
  signUp: vi.fn(),
  getUser: vi.fn(),
  enroll: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/domain/auth-throttle", () => ({
  checkAuthThrottle: mocks.throttle,
}));
vi.mock("@/providers/email", () => ({
  emailProvider: () => ({ send: mocks.send }),
}));
vi.mock("@/server/auth/supabase", () => ({
  supabaseServer: async () => ({
    auth: { signUp: mocks.signUp, getUser: mocks.getUser },
  }),
}));
vi.mock("@/domain/shop-signup", () => ({
  enrollShop: mocks.enroll,
  shopSignupInput: z.object({
    shopName: z.string().min(1),
    ownerName: z.string().min(1),
  }),
}));
vi.mock("@/server/request", () => ({
  getRequestMeta: async () => ({
    requestId: "test-request",
    ip: "127.0.0.1",
    userAgent: "test",
  }),
}));
vi.mock("@/server/actions/define", () => ({
  toActionError: (error: unknown) => ({
    message: error instanceof AppError ? error.message : "Please try again.",
  }),
}));

import {
  pilotOwnerEmail,
  shopSignupEnabledFor,
} from "@/lib/shop-signup-access";
import {
  createMyShop,
  sendPilotOwnerInvite,
  signUpOwner,
} from "@/server/actions/signup";

const email = "pilot-owner@example.test";
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const verified = {
  id: "8ff2a9f6-e693-4982-a67a-c6d175db6c2a",
  email,
  email_confirmed_at: "2026-11-22T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "false");
  vi.stubEnv(
    "PILOT_OWNER_SIGNUP_EMAILS",
    ` ${email.toUpperCase()} , second@example.test, *.invalid, @example.test`,
  );
  vi.stubEnv("APP_BASE_URL", "https://www.shoprevenue.app");
  mocks.throttle.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue({ providerMessageId: "accepted-message" });
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: verified }, error: null });
  mocks.enroll.mockResolvedValue({ businessId: "separate-shop" });
});
afterEach(() => vi.unstubAllEnvs());

describe("closed pilot owner eligibility", () => {
  it("normalizes exact addresses while keeping other signups closed", () => {
    expect(pilotOwnerEmail(` ${email.toUpperCase()} `)).toBe(email);
    expect(shopSignupEnabledFor(email)).toBe(true);
    for (const value of [
      undefined,
      null,
      [email],
      new Blob(),
      "",
      "other@example.test",
      `x${email}`,
      "pilot-owner+extra@example.test",
      "@example.test",
      "*.invalid",
    ])
      expect(pilotOwnerEmail(value)).toBeNull();
    expect(shopSignupEnabledFor("other@example.test")).toBe(false);
    expect(shopSignupEnabledFor()).toBe(false);
  });

  it("fails closed when no pilot addresses are configured and preserves public signup", () => {
    vi.stubEnv("PILOT_OWNER_SIGNUP_EMAILS", "");
    expect(shopSignupEnabledFor(email)).toBe(false);
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "true");
    expect(shopSignupEnabledFor("other@example.test")).toBe(true);
    expect(pilotOwnerEmail(email)).toBeNull();
  });
});

describe("private owner invitations", () => {
  it("sends only the approved recipient a fixed signup link on the trusted origin", async () => {
    const result = await sendPilotOwnerInvite(
      null,
      form({
        email: ` ${email.toUpperCase()} `,
        next: "https://evil.example",
        role: "admin",
      }),
    );
    expect(result.ok).toBe(true);
    expect(mocks.throttle).toHaveBeenCalledWith("invite", email, "127.0.0.1");
    expect(mocks.throttle.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.send.mock.invocationCallOrder[0],
    );
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: email,
        text: expect.stringContaining(
          "https://www.shoprevenue.app/sign-up?email=pilot-owner%40example.test",
        ),
      }),
    );
    expect(mocks.send.mock.calls[0][0].text).not.toContain("evil.example");
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("rejects arbitrary recipients even when public signup is enabled", async () => {
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "true");
    const result = await sendPilotOwnerInvite(
      null,
      form({ email: "other@example.test" }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.throttle).not.toHaveBeenCalled();
  });

  it("does not send when throttled or report provider failure as success", async () => {
    mocks.throttle.mockRejectedValueOnce(
      new AppError("RATE_LIMITED", "Try later."),
    );
    expect((await sendPilotOwnerInvite(null, form({ email }))).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.send.mockRejectedValueOnce(
      new AppError("PROVIDER_UNAVAILABLE", "Email is temporarily unavailable."),
    );
    expect(await sendPilotOwnerInvite(null, form({ email }))).toMatchObject({
      ok: false,
      message: "Email is temporarily unavailable.",
    });
  });
});

describe("owner signup and verified shop enrollment", () => {
  it("allows the approved email through normal password signup and email confirmation", async () => {
    const result = await signUpOwner(
      null,
      form({
        email: ` ${email.toUpperCase()} `,
        password: "TestOwnerPassword123!",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      message: expect.stringContaining("Check your email"),
    });
    expect(mocks.signUp).toHaveBeenCalledWith({
      email,
      password: "TestOwnerPassword123!",
      options: {
        emailRedirectTo:
          "https://www.shoprevenue.app/auth/callback?next=/start",
      },
    });
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("blocks nonapproved password signups while public signup stays closed", async () => {
    expect(
      (
        await signUpOwner(
          null,
          form({
            email: "other@example.test",
            password: "TestOwnerPassword123!",
          }),
        )
      ).ok,
    ).toBe(false);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("requires verified provider identity, regardless of a forged form email", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { ...verified, email_confirmed_at: null } },
      error: null,
    });
    expect(
      (
        await createMyShop(
          null,
          form({ email, ownerName: "Sam", shopName: "Shop" }),
        )
      ).ok,
    ).toBe(false);
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { ...verified, email: "other@example.test" } },
      error: null,
    });
    expect(
      (
        await createMyShop(
          null,
          form({ email, ownerName: "Sam", shopName: "Shop" }),
        )
      ).ok,
    ).toBe(false);
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("creates a separate shop using only verified identity then continues to billing", async () => {
    await expect(
      createMyShop(
        null,
        form({
          email: "forged@example.test",
          authSubject: "forged",
          role: "admin",
          businessId: "old-shop",
          ownerName: "Sam Owner",
          shopName: "Independent Shop",
        }),
      ),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.enroll).toHaveBeenCalledWith(
      { authSubject: verified.id, email, emailVerified: true },
      { ownerName: "Sam Owner", shopName: "Independent Shop" },
      expect.objectContaining({ requestId: "test-request" }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/app/settings/billing");
  });
});
