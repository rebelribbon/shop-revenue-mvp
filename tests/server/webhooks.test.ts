// Webhook suite (Section 22): invalid signature rejected; duplicate ignored;
// unknown event types stored as ignored; replay produces no double effects
// (the last two are in tests/domain). Route handlers are called directly with
// real Request objects; storage hits the real database.
import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { webhookEvent } from "@/db/schema";
import { withGlobalWorker } from "@/db/tenant";
import {
  verifyBasicAuth,
  verifyStripeSignature,
  verifyTwilioSignature,
} from "@/lib/webhooks/signatures";
import { verifyStandardWebhook } from "@/lib/standard-webhooks";

const STRIPE_SECRET = "whsec_test_secret";
const TWILIO_TOKEN = "twilio_test_token";

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
  process.env.TWILIO_AUTH_TOKEN = TWILIO_TOKEN;
  process.env.POSTMARK_WEBHOOK_USERNAME = "pm";
  process.env.POSTMARK_WEBHOOK_PASSWORD = "pm-pass";
  process.env.APP_BASE_URL = "https://app.example.test";
});

const stripeHeader = (
  body: string,
  secret = STRIPE_SECRET,
  t = Math.floor(Date.now() / 1000),
) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
const twilioSig = (
  url: string,
  params: Record<string, string>,
  token = TWILIO_TOKEN,
) =>
  createHmac("sha1", token)
    .update(
      Object.keys(params)
        .sort()
        .reduce((a, k) => a + k + params[k], url),
    )
    .digest("base64");
const stored = async (provider: string, id: string) =>
  withGlobalWorker((tx) =>
    tx.select().from(webhookEvent).where(eq(webhookEvent.providerEventId, id)),
  ).then((r) => r.filter((x) => x.provider === provider));

describe("signature helpers", () => {
  it("stripe: accepts valid, rejects wrong secret, tampered body and stale timestamps", () => {
    const body = '{"id":"evt_1"}';
    expect(verifyStripeSignature(body, stripeHeader(body), STRIPE_SECRET)).toBe(
      true,
    );
    expect(
      verifyStripeSignature(
        body,
        stripeHeader(body, "whsec_other"),
        STRIPE_SECRET,
      ),
    ).toBe(false);
    expect(
      verifyStripeSignature(
        '{"id":"evt_2"}',
        stripeHeader(body),
        STRIPE_SECRET,
      ),
    ).toBe(false);
    expect(
      verifyStripeSignature(
        body,
        stripeHeader(body, STRIPE_SECRET, Math.floor(Date.now() / 1000) - 3600),
        STRIPE_SECRET,
      ),
    ).toBe(false);
    expect(verifyStripeSignature(body, null, STRIPE_SECRET)).toBe(false);
  });

  it("twilio: agrees with the official twilio library's signature computation", async () => {
    const twilio = (await import("twilio")).default;
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = {
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675310",
      Digits: "1234",
      From: "+14158675310",
      To: "+18005551212",
    };
    const expected = twilio.getExpectedTwilioSignature("12345", url, params);
    expect(verifyTwilioSignature(url, params, expected, "12345")).toBe(true);
    expect(twilio.validateRequest("12345", expected, url, params)).toBe(true);
    expect(
      verifyTwilioSignature(
        url,
        { ...params, Digits: "9999" },
        expected,
        "12345",
      ),
    ).toBe(false);
    expect(verifyTwilioSignature(url, params, expected, "54321")).toBe(false);
  });

  it("postmark basic auth and Supabase hook signatures", () => {
    expect(
      verifyBasicAuth(
        `Basic ${Buffer.from("pm:pm-pass").toString("base64")}`,
        "pm",
        "pm-pass",
      ),
    ).toBe(true);
    expect(
      verifyBasicAuth(
        `Basic ${Buffer.from("pm:nope").toString("base64")}`,
        "pm",
        "pm-pass",
      ),
    ).toBe(false);
    const secret = `v1,whsec_${Buffer.from("hook-secret").toString("base64")}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"user":{}}';
    const sig = createHmac("sha256", Buffer.from("hook-secret"))
      .update(`msg_1.${ts}.${body}`)
      .digest("base64");
    expect(
      verifyStandardWebhook(
        secret,
        { id: "msg_1", timestamp: ts, signature: `v1,${sig}` },
        body,
      ),
    ).toBe(true);
    expect(
      verifyStandardWebhook(
        secret,
        { id: "msg_2", timestamp: ts, signature: `v1,${sig}` },
        body,
      ),
    ).toBe(false);
  });
});

describe("webhook routes", () => {
  it("stripe: invalid signature is rejected and nothing is stored; valid is stored once", async () => {
    const { POST } = await import("@/app/webhooks/stripe/route");
    const id = `evt_${randomUUID()}`;
    const body = JSON.stringify({
      id,
      type: "account.updated",
      account: "acct_123",
    });
    const bad = await POST(
      new Request("https://app.example.test/webhooks/stripe", {
        method: "POST",
        body,
        headers: { "stripe-signature": stripeHeader(body, "whsec_wrong") },
      }),
    );
    expect(bad.status).toBe(400);
    expect(await stored("stripe", id)).toHaveLength(0);
    for (let i = 0; i < 2; i++) {
      const ok = await POST(
        new Request("https://app.example.test/webhooks/stripe", {
          method: "POST",
          body,
          headers: { "stripe-signature": stripeHeader(body) },
        }),
      );
      expect(ok.status).toBe(200);
    }
    expect(await stored("stripe", id)).toHaveLength(1);
  });

  it("twilio inbound: validates against the public URL, returns empty TwiML, dedupes on MessageSid", async () => {
    const { POST } = await import("@/app/webhooks/twilio/sms/route");
    const sid = `SM${randomUUID().replace(/-/g, "")}`;
    const params = {
      MessageSid: sid,
      From: "+15125550100",
      To: "+15125550199",
      Body: "STOP",
    };
    const url = "https://app.example.test/webhooks/twilio/sms";
    const req = (sig: string) =>
      new Request("http://internal-host:3000/webhooks/twilio/sms", {
        method: "POST",
        body: new URLSearchParams(params).toString(),
        headers: {
          "x-twilio-signature": sig,
          "content-type": "application/x-www-form-urlencoded",
        },
      });
    expect((await POST(req(twilioSig(url, params, "wrong")))).status).toBe(400);
    const ok = await POST(req(twilioSig(url, params)));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("<Response></Response>");
    await POST(req(twilioSig(url, params)));
    expect(await stored("twilio", sid)).toHaveLength(1);
  });

  it("refuses to accept events when the secret is not configured", async () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { POST } = await import("@/app/webhooks/stripe/route");
    const r = await POST(
      new Request("https://app.example.test/webhooks/stripe", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(r.status).toBe(503);
    process.env.STRIPE_WEBHOOK_SECRET = saved;
  });
});
