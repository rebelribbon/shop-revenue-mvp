// EmailProvider (Section 11). Local: SMTP into Mailpit. Hosted: Resend (or legacy Postmark).
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
  const address = process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM;
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

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private token = process.env.RESEND_API_KEY) {}
  async send(e: OutboundEmail) {
    if (!this.token) throw new AppError("PROVIDER_UNAVAILABLE", "Email is not configured.");
    // Resolve local configuration outside the transport catch; never forward raw provider errors.
    const sender = from(e.fromName);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        redirect: "error",
        body: JSON.stringify({ from: sender, to: [e.to], subject: e.subject, text: e.text, reply_to: e.replyTo }),
        signal: AbortSignal.timeout(10_000),
      });
      const body: unknown = await res.json();
      if (!res.ok || !body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || !body.id.trim()) {
        throw new Error("Email provider did not acknowledge delivery request");
      }
      return { providerMessageId: body.id };
    } catch {
      throw new AppError("PROVIDER_UNAVAILABLE", "Email could not be sent right now.");
    }
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
  if (["production", "staging"].includes(env) && !["postmark", "resend"].includes(choice)) {
    throw new Error(`EMAIL_PROVIDER=${choice} is not allowed in ${env}`);
  }
  if (!["smtp", "memory", "postmark", "resend"].includes(choice)) throw new Error(`Unknown email provider: ${choice}`);
  instance = choice === "resend" ? new ResendEmailProvider() : choice === "smtp" ? new SmtpEmailProvider() : choice === "memory" ? new MemoryEmailProvider() : new PostmarkEmailProvider();
  return instance;
}
export const setEmailProviderForTests = (p: EmailProvider | null) => {
  instance = p;
};

