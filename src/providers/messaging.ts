// MessagingProvider (Section 11). In Milestone 1 only system messages go out
// (invites, login and MFA codes) from our own primary Twilio account; per-shop
// subaccounts arrive with Milestone 5. Local and preview use the fake adapter:
// messages land in a dev-only inbox file shown at /dev/inbox (Section 23).
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";

export type OutboundSms = { to: string; body: string; purpose: "system" };
export type SmsResult = {
  providerMessageId: string;
  status: "queued" | "sent";
};

export interface MessagingProvider {
  readonly name: string;
  sendSystemSms(sms: OutboundSms): Promise<SmsResult>;
}

export const DEV_INBOX_FILE = ".dev-inbox/messages.jsonl";

export class FakeMessagingProvider implements MessagingProvider {
  readonly name = "fake";
  async sendSystemSms(sms: OutboundSms) {
    const id = `SMfake${randomUUID().replace(/-/g, "")}`;
    mkdirSync(".dev-inbox", { recursive: true });
    appendFileSync(
      DEV_INBOX_FILE,
      JSON.stringify({
        id,
        at: new Date().toISOString(),
        direction: "outbound",
        ...sms,
      }) + "\n",
    );
    return { providerMessageId: id, status: "queued" as const };
  }
}

export function readDevInbox(): Array<{
  id: string;
  at: string;
  to: string;
  body: string;
  purpose: string;
}> {
  if (!existsSync(DEV_INBOX_FILE)) return [];
  return readFileSync(DEV_INBOX_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .reverse();
}

export class TwilioMessagingProvider implements MessagingProvider {
  readonly name = "twilio";
  async sendSystemSms(sms: OutboundSms) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const service = process.env.TWILIO_SYSTEM_MESSAGING_SERVICE_SID;
    if (!sid || !token || !service)
      throw new AppError("PROVIDER_UNAVAILABLE", "Texting is not configured.");
    let res: Response;
    try {
      res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: sms.to,
            Body: sms.body,
            MessagingServiceSid: service,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        "Texting is unavailable right now.",
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      code?: number;
    };
    if (!res.ok || !body.sid)
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        "Texting is unavailable right now.",
        { providerCode: body.code },
      );
    // Accepted by Twilio is "queued", never "delivered": delivery comes from status callbacks.
    return { providerMessageId: body.sid, status: "queued" as const };
  }
}

let instance: MessagingProvider | null = null;
export function messagingProvider(): MessagingProvider {
  if (instance) return instance;
  const env = process.env.APP_ENV ?? "local";
  const choice =
    process.env.MESSAGING_PROVIDER ??
    (["local", "test", "preview"].includes(env) ? "fake" : "twilio");
  if (["production", "staging"].includes(env) && choice !== "twilio") {
    throw new Error(`MESSAGING_PROVIDER=${choice} is not allowed in ${env}`);
  }
  instance =
    choice === "fake"
      ? new FakeMessagingProvider()
      : new TwilioMessagingProvider();
  return instance;
}
