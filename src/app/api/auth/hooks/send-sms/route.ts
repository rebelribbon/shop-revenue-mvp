// Supabase Auth "Send SMS" hook: phone sign-in codes and MFA codes are system
// messages sent by our MessagingProvider (Section 11: our primary Twilio account;
// locally the fake adapter's dev inbox). The code is never logged.
import { messagingProvider } from "@/providers/messaging";
import { logger } from "@/lib/logger";
import { maskPhone } from "@/lib/normalize";
import { verifyStandardWebhook } from "@/lib/standard-webhooks";

export async function POST(req: Request) {
  const secret = process.env.SUPABASE_AUTH_HOOK_SECRET;
  const body = await req.text();
  if (
    !secret ||
    !verifyStandardWebhook(
      secret,
      {
        id: req.headers.get("webhook-id"),
        timestamp: req.headers.get("webhook-timestamp"),
        signature: req.headers.get("webhook-signature"),
      },
      body,
    )
  ) {
    return Response.json(
      { error: { http_code: 401, message: "invalid signature" } },
      { status: 401 },
    );
  }
  const payload = JSON.parse(body) as {
    user?: { phone?: string };
    sms?: { otp?: string };
  };
  const phone = payload.user?.phone
    ? `+${payload.user.phone.replace(/^\+/, "")}`
    : null;
  const otp = payload.sms?.otp;
  if (!phone || !otp)
    return Response.json(
      { error: { http_code: 400, message: "missing phone or code" } },
      { status: 400 },
    );
  try {
    await messagingProvider().sendSystemSms({
      to: phone,
      body: `Your sign-in code is ${otp}. It expires in 10 minutes.`,
      purpose: "system",
    });
    logger.info({ event: "auth.sms_code_sent", to: maskPhone(phone) });
    return Response.json({});
  } catch {
    // Tell Supabase Auth the send failed; the user sees an error, never a fake success.
    return Response.json(
      { error: { http_code: 503, message: "SMS provider unavailable" } },
      { status: 503 },
    );
  }
}
