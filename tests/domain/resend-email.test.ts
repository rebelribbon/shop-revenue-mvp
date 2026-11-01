import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResendEmailProvider,
  emailProvider,
  setEmailProviderForTests,
} from "@/providers/email";
import { releaseConfiguration } from "@/lib/release-readiness";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setEmailProviderForTests(null);
});
const message = {
  to: "owner@example.test",
  subject: "Test invitation",
  text: "Private link",
  replyTo: "shop@example.test",
};
describe("Resend email transport", () => {
  it("sends text and reply-to to the fixed provider and requires acknowledgement", async () => {
    vi.stubEnv("EMAIL_FROM_ADDRESS", "shop-revenue@example.test");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "provider-id" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new ResendEmailProvider("test-only-token").send(message),
    ).resolves.toEqual({ providerMessageId: "provider-id" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({
      from: "shop-revenue@example.test",
      to: [message.to],
      subject: message.subject,
      text: message.text,
      reply_to: message.replyTo,
    });
  });
  it.each([
    [403, { message: "secret-provider-body" }],
    [200, {}],
    [200, { id: "" }],
    [200, { id: 23 }],
  ])(
    "rejects unusable provider acknowledgement %s %j",
    async (status, body) => {
      vi.stubEnv("EMAIL_FROM_ADDRESS", "shop-revenue@example.test");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify(body), { status })),
      );
      await expect(
        new ResendEmailProvider("test-only-token").send(message),
      ).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        message: "Email could not be sent right now.",
      });
    },
  );
  it("sanitizes network failures and refuses missing credentials without making a request", async () => {
    vi.stubEnv("EMAIL_FROM_ADDRESS", "shop-revenue@example.test");
    const fetcher = vi.fn().mockRejectedValue(new Error("secret-token"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new ResendEmailProvider("test-only-token").send(message),
    ).rejects.toThrow("Email could not be sent right now.");
    fetcher.mockClear();
    await expect(new ResendEmailProvider("").send(message)).rejects.toThrow(
      "Email is not configured.",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows Resend in hosted environments and rejects memory and misspelled providers", () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    expect(emailProvider().name).toBe("resend");
    setEmailProviderForTests(null);
    vi.stubEnv("EMAIL_PROVIDER", "memory");
    expect(() => emailProvider()).toThrow("not allowed");
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("EMAIL_PROVIDER", "resned");
    expect(() => emailProvider()).toThrow("Unknown email provider");
  });
  it("recognizes the real sender variable and configured provider independently", () => {
    const ready = (env: Record<string, string>) =>
      releaseConfiguration(env).find((c) => c.key === "email")?.ready;
    expect(
      ready({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "test-only-token",
        EMAIL_FROM_ADDRESS: "shop@example.test",
      }),
    ).toBe(true);
    expect(
      ready({
        EMAIL_PROVIDER: "resend",
        EMAIL_FROM_ADDRESS: "shop@example.test",
      }),
    ).toBe(false);
    expect(
      ready({
        EMAIL_PROVIDER: "resend",
        POSTMARK_SERVER_TOKEN: "test-only-token",
        EMAIL_FROM_ADDRESS: "shop@example.test",
      }),
    ).toBe(false);
  });
});
