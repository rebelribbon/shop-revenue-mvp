import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { newToken } from "@/lib/tokens";
import { GET } from "@/app/stripe/connect/callback/route";
const mocked = vi.hoisted(() => ({
  get: vi.fn(),
  session: vi.fn(),
  mfa: vi.fn(),
  finish: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocked.get }) }));
vi.mock("@/server/auth/session", () => ({ getSessionState: mocked.session }));
vi.mock("@/server/auth/assurance", () => ({ sessionNeedsMfa: mocked.mfa }));
vi.mock("@/domain/stripe-connect", () => ({
  finishStripeConnection: mocked.finish,
}));
vi.mock("@/server/actions/define", () => ({ toActionError: mocked.error }));
vi.mock("@/server/request", () => ({
  getRequestMeta: async () => ({ requestId: "test-callback", ip: null }),
}));
let state: string;
const owner = () => ({
  kind: "shop",
  session: {
    businessId: randomUUID(),
    actor: { type: "user", id: randomUUID() },
    role: "owner",
  },
});
const request = (params = "") =>
  new Request(
    `https://host-untrusted.example/stripe/connect/callback?state=${state}&${params}`,
  );
beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_ENV = "test";
  process.env.PAYMENTS_BASE_URL = "https://payments.example.test";
  state = newToken().token;
  mocked.get.mockReturnValue({ value: state });
  mocked.session.mockResolvedValue(owner());
  mocked.mfa.mockResolvedValue(false);
  mocked.finish.mockResolvedValue({ canceled: false, active: true });
});
it("redirects only to the configured app, clears the matching cookie, and keeps the authorization query private", async () => {
  const response = await GET(
    request("code=ac_test_callback&next=https://evil.example"),
  );
  expect(mocked.finish).toHaveBeenCalledWith(
    expect.objectContaining({ role: "owner" }),
    expect.anything(),
    state,
    "ac_test_callback",
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://payments.example.test/app/settings/payments?stripe=connected",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).not.toContain("ac_test_callback");
});
it("rejects missing, mismatched and duplicate state without consuming an attempt or clearing a valid cookie", async () => {
  for (const cookie of [
    undefined,
    { value: "bad" },
    { value: newToken().token },
  ]) {
    mocked.get.mockReturnValue(cookie);
    const response = await GET(request("code=ac_forged"));
    expect(response.headers.get("location")).toContain("stripe=expired");
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  mocked.get.mockReturnValue({ value: state });
  await GET(request(`code=ac_forged&state=${state}`));
  expect(mocked.finish).not.toHaveBeenCalled();
});
it("requires an authenticated owner and MFA without forwarding an OAuth code into sign-in", async () => {
  for (const [session, location] of [
    [{ kind: "anonymous" }, "/sign-in?next="],
    [{ kind: "no_access" }, "/no-access"],
    [
      { kind: "shop", session: { role: "staff", actor: { type: "user" } } },
      "/app?denied=1",
    ],
    [
      { kind: "shop", session: { role: "owner", actor: { type: "support" } } },
      "/app?denied=1",
    ],
  ] as const) {
    mocked.session.mockResolvedValue(session);
    const response = await GET(request("code=ac_private"));
    expect(response.headers.get("location")).toContain(location);
    expect(response.headers.get("location")).not.toContain("ac_private");
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  mocked.session.mockResolvedValue(owner());
  mocked.mfa.mockResolvedValue(true);
  expect(
    (await GET(request("code=ac_private"))).headers.get("location"),
  ).toContain("/verify?next=");
  expect(mocked.finish).not.toHaveBeenCalled();
});
it("consumes a customer cancellation and ignores untrusted provider descriptions", async () => {
  mocked.finish.mockResolvedValue({ canceled: true });
  const response = await GET(
    request("error=access_denied&error_description=private-information"),
  );
  expect(mocked.finish).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    state,
    null,
  );
  expect(response.headers.get("location")).toContain("stripe=canceled");
  expect(response.headers.get("location")).not.toContain("private-information");
});
it("returns a neutral error after a failed one-time exchange", async () => {
  mocked.finish.mockRejectedValue(new Error("private provider body"));
  const response = await GET(request("code=ac_test_failed"));
  expect(mocked.finish).toHaveBeenCalledTimes(1);
  expect(response.headers.get("location")).toContain("stripe=error");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(await response.text()).not.toContain("private provider body");
});
