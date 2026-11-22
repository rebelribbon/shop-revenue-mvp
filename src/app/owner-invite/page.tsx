import Link from "next/link";
import { HydratedMain } from "@/components/hydrated-main";
import { pilotOwnerEmail } from "@/lib/shop-signup-access";
import { OwnerInviteForm } from "./owner-invite-form";

export default async function OwnerInvitePage({
  searchParams,
}: PageProps<"/owner-invite">) {
  const email = pilotOwnerEmail((await searchParams).email);
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Set up your own shop</h1>
      {email ? (
        <>
          <p>
            Send your invitation to choose a password, confirm your email and
            create your own shop.
          </p>
          <OwnerInviteForm email={email} />
        </>
      ) : (
        <p>
          This invitation is not available. Check the link you received or
          contact the person who invited you.
        </p>
      )}
      <p>
        <Link href="/sign-in?next=/start">Already have a login? Sign in</Link>
      </p>
    </HydratedMain>
  );
}
