import { peekInvite } from "@/domain/membership";
import { getIdentity } from "@/server/auth/session";
import { AcceptInvite, InviteSignIn } from "./invite-forms";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await peekInvite(token);
  if (!invite) {
    return (
      <main id="main-content" tabIndex={-1}>
        <h1>Invite unavailable</h1>
        <p>
          This invite link is no longer valid. Ask the shop owner to send a new
          one.
        </p>
      </main>
    );
  }
  const identity = await getIdentity();
  const matches =
    !!identity &&
    ((!!invite.inviteEmail && identity.email === invite.inviteEmail) ||
      (!!invite.invitePhoneE164 &&
        identity.phoneE164 === invite.invitePhoneE164));
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Join {invite.businessName}</h1>
      <p className="muted">
        You were invited as {invite.role === "owner" ? "the owner" : "staff"}.
      </p>
      {matches ? (
        <AcceptInvite token={token} suggestedName="" />
      ) : (
        <InviteSignIn token={token} />
      )}
      {identity && !matches && (
        <p className="muted">
          You’re signed in with a different email or number than this invite was
          sent to.
        </p>
      )}
    </main>
  );
}
