# Resend setup (replaces Postmark for Shop Revenue)

Approved provider change: Resend for application transactional email. Existing Postmark configuration remains supported for compatibility, but new Shop Revenue setup uses Resend. Automated customer outreach remains out of scope.

## Preview configuration

In Vercel project shop-revenue-mvp, save a separate sending-only key scoped to shoprevenue.app as RESEND_API_KEY, type Secret, Preview only. Never expose it under a NEXT_PUBLIC_ name. Set EMAIL_PROVIDER=resend and EMAIL_FROM_ADDRESS=no-reply@shoprevenue.app. The legacy EMAIL_FROM name is accepted as a fallback; the actual sender variable is EMAIL_FROM_ADDRESS.

Use separate credentials for production. Deploy the reviewed code before enabling EMAIL_PROVIDER=resend. A successful API acknowledgement means accepted for sending, not delivered to the recipient. Verify the invite in Resend's delivery log and the recipient inbox before recording email-delivery evidence.

## Supabase Auth email is separate

App invites use the application email adapter. Password resets and Supabase Auth invitations use the Supabase project's custom SMTP configuration, which must be configured independently with Resend's documented SMTP settings and securely entered credentials. Confirm the correct preview/production project before changes. Do not assume app EMAIL_PROVIDER changes affect Auth email. Test reset receipt and completion separately; never copy production credentials into preview.

## Verification

Transport tests cover success acknowledgements, missing/invalid acknowledgements, provider rejection, missing credentials, sanitized network errors, hosted provider restrictions, and readiness configuration. They replace the HTTP transport only in tests and send no real email. Hosted delivery and SMTP verification remain account-side checks.

Official API reference: https://resend.com/docs/api-reference/emails/send-email
