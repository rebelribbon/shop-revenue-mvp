import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ signOut: vi.fn(), deleteCookie: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: mocks.deleteCookie }),
}));
vi.mock("@/server/auth/supabase", () => ({
  supabaseServer: async () => ({ auth: { signOut: mocks.signOut } }),
}));
vi.mock("@/server/auth/session", () => ({
  ACTIVE_BUSINESS_COOKIE: "active_business",
  VIEW_AS_COOKIE: "view_as",
  PASSWORD_RESET_COOKIE: "pw_reset",
}));
import { GET, POST } from "@/app/auth/sign-out/route";

const request = (method: "GET" | "POST", origin?: string) =>
  new NextRequest(
    "https://www.shoprevenue.app/auth/sign-out?next=https://evil.example",
    { method, headers: origin ? { origin } : {} },
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
});

it("takes old GET links to a real page without logging anyone out or offering a file", () => {
  const response = GET(request("GET"));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://www.shoprevenue.app/sign-out",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.has("content-disposition")).toBe(false);
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.deleteCookie).not.toHaveBeenCalled();
});

it("posts logout, clears app session choices and redirects to sign in without caching", async () => {
  const response = await POST(request("POST", "https://www.shoprevenue.app"));
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(mocks.deleteCookie.mock.calls.map(([name]) => name).sort()).toEqual([
    "active_business",
    "pw_reset",
    "sr_authenticator_step",
    "sr_email_step",
    "sr_password_step",
    "view_as",
  ]);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://www.shoprevenue.app/sign-in",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("blocks cross-origin logout before changing authentication or cookies", async () => {
  const response = await POST(request("POST", "https://evil.example"));
  expect(response.status).toBe(403);
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.deleteCookie).not.toHaveBeenCalled();
});
