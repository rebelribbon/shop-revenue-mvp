# November 25 account setup and public entry

The owner requested implementation of the final handoff from “Simplify CRM Customer View”: a public product website with pricing and Create account, registration, a choice of email codes or an authenticator after password sign-in, recovery usable on a different browser/device, readable labels, and saved business onboarding. No SMS or new paid infrastructure is introduced.

The customer approval simplification and readable technician findings are already on main in #121. This release preserves them.

## Account security

Password sign-in remains required. Email verification is an application second step, not a Supabase AAL2 claim. Its signed, HTTP-only proof is bound to the verified identity, provider session, account security version and a 12-hour expiry. All existing shop guards accept the proof. Internal administration retains native authenticator verification. Changing the selected method requires fresh verification of the current method; selecting email replaces the provider TOTP factor only after verifying the new code.

Email challenges expire in ten minutes, allow five attempts, have a one-minute resend cooldown, store keyed hashes and are consumed under a lock. Codes and grants never appear in logs or idempotency records. Server-side recipients come from the authenticated account. Sign-out and password reset clear local proofs, and changing methods invalidates old email proofs. Account security and onboarding tables are unavailable to browser, tenant and worker roles.

Confirmation and recovery emails contain a provider token hash and six-digit alternative. GET only renders a confirmation page; an explicit POST consumes the token. This prevents mail previews from using a reset link. Old provider callbacks remain available for already-sent messages.

## Saved setup

The setup wizard saves business type/name, business contact details, subscription step, operating preferences, team step and customer-payment step. Account-scoped database progress resumes on another device. Version checks reject stale submissions. Shop enrollment is still idempotent and verified-email-only. Tax confirmation and all subscription gates remain enforced. Optional team/payment setup may be completed later; finishing the wizard never claims Stripe is connected or records a subscription payment.

## Owner-requested early access

The previous invitation-only pilot profile still requires public signup closed. The new explicit `early_access` profile supports the owner's request to open the registration flow before advertising. It requires signup open, all technical release checks, an exact reviewed commit, migrations, real CI and browser verification, and an existing provider restore point. Commercial launch evidence remains visible as pending and `launchReady` remains false until the existing independent commercial review requirements are satisfied. The `commercial` profile and its evidence requirements are preserved.

## Release steps

Apply migration 0059 as migration_owner, retaining the Drizzle ledger. Verify the row-level protections and schema health. Publish the exact tested production build with PUBLIC_SIGNUP_ENABLED=true and RELEASE_PROFILE=early_access. Install the committed confirmation/recovery templates in hosted Auth and confirm custom SMTP delivery and six-digit OTP configuration. Test the canonical website, public account setup, cross-device recovery, native and email second steps, and the saved setup path before reporting completion.
