import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mfaRequired } from "@/lib/mfa-policy";
import {
  assertSessionAssurance,
  sessionNeedsMfa,
} from "@/server/auth/assurance";
import type { SessionState } from "@/server/auth/session";
import { GET as reportGet } from "@/app/app/money/reports/csv/route";
import { GET as documentGet } from "@/app/app/documents/[id]/pdf/route";
import { GET as mediaGet } from "@/app/media/[fileId]/route";
import { GET as exportGet } from "@/app/app/settings/export/[dataset]/route";
import {
  connectStripeAction,
  reconcileStripeAction,
} from "@/server/actions/payments";
import { lookupVinAction } from "@/server/actions/vin";

const mocks = vi.hoisted(() => ({
  assurance: vi.fn(),
  read: vi.fn(),
}));
let state: SessionState;
vi.mock("@/server/request", () => ({
  getRequestMeta: async () => ({ requestId: "mfa-test-request" }),
}));
vi.mock("@/server/auth/supabase", async (original) => ({
  ...(await original<typeof import("@/server/auth/supabase")>()),
  supabaseServer: async () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: mocks.assurance } },
  }),
}));
vi.mock("@/server/auth/session", async (original) => ({
  ...(await original<typeof import("@/server/auth/session")>()),
  getSessionState: async () => state,
}));
vi.mock("@/db/tenant", async (original) => ({
  ...(await original<typeof import("@/db/tenant")>()),
  withTenant: mocks.read,
}));

beforeEach(() => {
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("REQUIRE_MFA", "false");
  vi.stubEnv("REQUIRE_OWNER_MFA", "false");
  mocks.assurance.mockReset().mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  });
  mocks.read.mockReset();
  const userId = randomUUID();
  const authSubject = randomUUID();
  state = {
    kind: "shop",
    identity: { authSubject, email: null, phoneE164: null, provider: "email" },
    session: {
      businessId: randomUUID(),
      actor: { type: "user", id: userId, authSubject },
      userId,
      role: "owner",
      supportSession: null,
    },
  };
});
afterEach(() => vi.unstubAllEnvs());

it.each(["production", "staging", "preview"])(
  "requires a second factor on %s even when override flags are false",
  async (environment) => {
    vi.stubEnv("APP_ENV", environment);
    expect(await sessionNeedsMfa()).toBe(true);
    await expect(assertSessionAssurance()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  },
);

it("allows an AAL2 session and refuses unavailable assurance checks", async () => {
  mocks.assurance.mockResolvedValueOnce({
    data: { currentLevel: "aal2", nextLevel: "aal2" },
    error: null,
  });
  await expect(assertSessionAssurance()).resolves.toBeUndefined();
  mocks.assurance.mockResolvedValueOnce({
    data: null,
    error: new Error("down"),
  });
  await expect(assertSessionAssurance()).rejects.toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
  });
});

it("limits the development bypass to local Auth and supports an enforced local smoke test", () => {
  const local = {
    APP_ENV: "local",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };
  expect(mfaRequired(local)).toBe(false);
  expect(mfaRequired({ ...local, REQUIRE_MFA: "true" })).toBe(true);
  expect(mfaRequired(local, true)).toBe(true);
  expect(
    mfaRequired({
      ...local,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    }),
  ).toBe(true);
  expect(mfaRequired({ ...local, NEXT_PUBLIC_SUPABASE_URL: "invalid" })).toBe(
    true,
  );
});

const reads: [string, () => Promise<Response>][] = [
  [
    "report CSV",
    () =>
      reportGet(
        new Request("https://example.test/app/money/reports/csv?report=sales"),
      ),
  ],
  [
    "signed PDF",
    () =>
      documentGet(new Request("https://example.test/app/documents/pdf"), {
        params: Promise.resolve({ id: randomUUID() }),
      }),
  ],
  [
    "shop media",
    () =>
      mediaGet(new Request("https://example.test/media/file"), {
        params: Promise.resolve({ fileId: randomUUID() }),
      }),
  ],
  [
    "owner export",
    () =>
      exportGet(
        new Request("https://example.test/app/settings/export/customers"),
        { params: Promise.resolve({ dataset: "customers" }) },
      ),
  ],
];
it.each(reads)(
  "refuses a direct %s request before reading customer data without MFA",
  async (_name, read) => {
    const response = await read();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it.each(["staff", "technician"] as const)(
  "requires MFA on a direct staff PDF request for %s",
  async (role) => {
    if (state.kind !== "shop") throw new Error("Expected shop session");
    state.session.role = role;
    const response = await documentGet(
      new Request("https://example.test/app/documents/pdf"),
      { params: Promise.resolve({ id: randomUUID() }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it("allows the signed PDF after MFA and preserves private cache headers", async () => {
  mocks.assurance.mockResolvedValue({
    data: { currentLevel: "aal2", nextLevel: "aal2" },
    error: null,
  });
  mocks.read.mockResolvedValue({
    title: "Approved work",
    pdf: Buffer.from("test PDF"),
  });
  const response = await documentGet(
    new Request("https://example.test/app/documents/pdf"),
    { params: Promise.resolve({ id: randomUUID() }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.read).toHaveBeenCalledOnce();
});

it("refuses standalone shop payment and VIN actions before MFA", async () => {
  for (const action of [connectStripeAction, reconcileStripeAction])
    expect(await action()).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  expect(await lookupVinAction("1HGCM82633A004352")).toMatchObject({
    ok: false,
    message: "Verify your authenticator code before continuing.",
  });
  expect(mocks.read).not.toHaveBeenCalled();
});
