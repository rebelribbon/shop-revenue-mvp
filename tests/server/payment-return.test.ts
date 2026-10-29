import { randomUUID } from "node:crypto";
import { it, expect, vi, beforeEach } from "vitest";
import { newToken } from "@/lib/tokens";
const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
import { GET } from "@/app/payment-return/[checkoutId]/route";
beforeEach(() => {
  jar.get.mockReset();
  jar.set.mockReset();
  process.env.PAYMENTS_BASE_URL = "https://payments.example.test";
});
it("returns to the invoice using only the attempt's HttpOnly cookie and never claims it paid", async () => {
  const checkoutId = randomUUID();
  const token = newToken().token;
  jar.get.mockReturnValue({ value: token });
  const response = await GET(
    new Request(
      `https://payments.example.test/payment-return/${checkoutId}?outcome=paid&redirect=https://evil.example`,
    ),
    { params: Promise.resolve({ checkoutId }) },
  );
  expect(jar.get).toHaveBeenCalledWith(`invoice_return_${checkoutId}`);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    `https://payments.example.test/invoice/${token}?payment=processing`,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(jar.set).toHaveBeenCalledWith(
    `invoice_return_${checkoutId}`,
    "",
    expect.objectContaining({
      maxAge: 0,
      httpOnly: true,
      path: "/payment-return",
    }),
  );
});
it("shows a neutral page when the return cookie is absent or invalid without revealing financial data", async () => {
  for (const value of [undefined, { value: "malformed" }]) {
    jar.get.mockReturnValue(value);
    const response = await GET(
      new Request("https://payments.example.test/payment-return/unknown"),
      { params: Promise.resolve({ checkoutId: randomUUID() }) },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Return to your invoice");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("location")).toBeNull();
  }
});
