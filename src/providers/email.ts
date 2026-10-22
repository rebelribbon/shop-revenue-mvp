// EmailProvider (Section 11). Local: SMTP into Mailpit. Production: Postmark.
// Tests: in-memory capture. Adapters never report success the provider did not give.
import nodemailer from "nodemailer";
import { AppError } from "@/lib/errors";

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  // "Mike's Auto via Product" display name; Reply-To the shop (Section 11)
  fromName?: string;
  replyTo?: string;
  messageStream?: "outbound" | "broadcast";
  metadata?: Record<string, string>;
};
export type EmailResult = { providerMessageId: string };

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<EmailResult>;
}

const from = (name?: string) => {
  const address = process.env.EMAIL_FROM_ADDRESS;
  if (!address) throw new AppError("PROVIDER_UNAVAILABLE", "Email is not configured.");
  return name ? `"${name.replace(/"/g, "")}" <${address}>` : address;
};

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
  });
  async send(e: OutboundEmail) {
    const info = await this.transport.sendMail({ from: from(e.fromName), to: e.to, subject: e.subject, text: e.text, replyTo: e.replyTo });
    return { providerMessageId: info.messageId };
  }
}

export class PostmarkEmailProvider implements EmailProvider {
  readonly name = "postmark";
  constructor(private token = process.env.POSTMARK_SERVER_TOKEN) {}
  async send(e: OutboundEmail) {
    if (!this.token) throw new AppError("PROVIDER_UNAVAILABLE", "Email is not configured.");
    let res: Response;
    try {
      res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { "X-Postmark-Server-Token": this.token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          From: from(e.fromName),
          To: e.to,
          Subject: e.subject,
          TextBody: e.text,
          ReplyTo: e.replyTo,
          MessageStream: e.messageStream ?? "outbound",
          Metadata: e.metadata,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError("PROVIDER_UNAVAILABLE", "Email could not be sent right now.");
    }
    const body = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
    if (!res.ok || body.ErrorCode || !body.MessageID) {
      throw new AppError("PROVIDER_UNAVAILABLE", "Email could not be sent right now.", { providerCode: body.ErrorCode });
    }
    return { providerMessageId: body.MessageID };
  }
}

export class MemoryEmailProvider implements EmailProvider {
  readonly name = "memory";
  readonly sent: OutboundEmail[] = [];
  async send(e: OutboundEmail) {
    this.sent.push(e);
    return { providerMessageId: `memory-${this.sent.length}` };
  }
}

let instance: EmailProvider | null = null;
export function emailProvider(): EmailProvider {
  if (instance) return instance;
  const env = process.env.APP_ENV ?? "local";
  const choice = process.env.EMAIL_PROVIDER ?? (env === "local" ? "smtp" : env === "test" ? "memory" : "postmark");
  if (["production", "staging"].includes(env) && choice !== "postmark") {
    throw new Error(`EMAIL_PROVIDER=${choice} is not allowed in ${env}`);
  }
  instance = choice === "smtp" ? new SmtpEmailProvider() : choice === "memory" ? new MemoryEmailProvider() : new PostmarkEmailProvider();
  return instance;
}
export const setEmailProviderForTests = (p: EmailProvider | null) => {
  instance = p;
};
