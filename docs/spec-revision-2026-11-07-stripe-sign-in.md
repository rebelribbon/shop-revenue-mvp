# Connect a shop's existing Stripe account

Date: November 7, 2026

The owner requested signing in to an existing Stripe account from Online
payments. New shop connections now use Stripe's hosted OAuth authorization
screen, initially showing login. Stripe also offers account creation there.
Shops keep the full Stripe Dashboard, pay Stripe's processing fees directly,
and receive direct invoice charges without a Shop Revenue transaction fee.
The separate Shop Revenue subscription is unchanged.

Accounts connected through OAuth use Accounts v1 because Stripe does not support
OAuth-authenticated accounts through Accounts v2. Existing hosted Accounts v2
connections retain their existing setup and capability checks. This is an
explicit compatibility boundary, not a migration of customer payment history.

Only a signed-in shop owner who has satisfied the app's MFA requirement can
start or finish a connection. Authorization attempts are bound to the business,
owner, environment and a ten-minute random state, hashed in the database and
matched to a host-only HttpOnly SameSite cookie. The database consumes a state
before the token request. Stripe's non-idempotent token exchange has SDK retries
disabled; uncertain results require a new authorization. The app retains the
trusted account ID, never OAuth access/refresh tokens or authorization codes.
An account cannot be assigned to multiple shops or silently replaced on
reconnection. Deauthorization disables online checkout while retaining history,
and a concurrent account refresh cannot undo that state.

Production activation remains incomplete. The two live account-creation requests
on November 7 returned `account_create_activation_required`. Stripe lists a
past-due external bank account task; its live OAuth client ID is unavailable and
the OAuth switch is disabled. No live client ID is fabricated. When the client ID
is absent, Online payments explains that activation is pending instead of
sending owners into the failed account-creation path.

After the owner completes Stripe activation and any review, enable OAuth for
Stripe Dashboard accounts and register exactly
`https://www.shoprevenue.app/stripe/connect/callback`. Configure the platform's
live `STRIPE_CONNECT_CLIENT_ID` in production, retain separate sandbox settings,
and redeploy. Verify that the scoped production API credential can exchange the
authorization code and retrieve the authorized account. Receive
`account.application.deauthorized` on the existing signed Connect webhook.
The owner must grant the actual Stripe authorization personally. Deployment and
mock-provider tests do not prove a live connection, charge, refund or bank payout.

Provider failure logging retains an allowlisted category, HTTP status, Stripe
request ID and app request ID. Provider messages, bodies, OAuth credentials and
personal data are excluded. Existing legal-policy approval and closed-pilot
restrictions remain enforced.

Follow-up diagnosis on November 7: the live Platform profile explicitly says
Onboarding incomplete, and its OAuth client ID remains unavailable. Its View
onboarding control starts the sandbox guide; the live-account checklist blocks
Confirm your integration choices until owner verification is finished. The
provider's actual activation form at
`https://dashboard.stripe.com/acct_1UVIoCK3kUALRyLg/account/onboarding/overview`
shows Verify your business and Review and submit as not started. The outstanding
bank task alone is not proof that platform activation is complete. No liability
acknowledgement, identity declaration or financial account activation is submitted
on the owner's behalf. Ordinary shop owners do not receive access or links to
the SaaS platform's private setup. Their page keeps Connect Stripe visible and
explains platform unavailability until genuine configuration enables the
existing authorization flow.
