import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CopyLink } from "@/components/copy-link";
import { HydratedMain } from "@/components/hydrated-main";
import { withTenant } from "@/db/tenant";
import { bookingSlug } from "@/domain/booking";
import { setBookingAction } from "@/server/actions/booking";
import { requireOwnerView } from "@/server/views/shop";

export default async function BookingSettingsPage() {
  const s = await requireOwnerView("/app/settings/booking");
  const slug = await withTenant(s.businessId, s.actor, (tx) => bookingSlug(tx));
  const readOnly = s.actor.type === "support";
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p>
        <Link href="/app/settings">← Settings</Link>
      </p>
      <h1>Online booking</h1>
      <p className="muted">
        Put this link on your website, Google profile and social pages. Each
        request becomes a new customer and a task to call them back today.
      </p>
      {slug ? (
        <section className="card" aria-label="Your booking link">
          <h2>Your booking link</h2>
          <CopyLink
            path={`/book/${slug}`}
            label="Copy booking link"
            title="Book a visit"
          />
          <p>
            <Link href={`/book/${slug}`} target="_blank">
              Open your booking page
            </Link>
          </p>
          {!readOnly && (
            <ActionForm
              action={setBookingAction}
              hidden={{ on: "false" }}
              submitLabel="Turn off booking link"
              variant="danger"
              confirm="Turn off the booking link? The old link stops working."
            />
          )}
        </section>
      ) : (
        !readOnly && (
          <ActionForm
            action={setBookingAction}
            hidden={{ on: "true" }}
            submitLabel="Create my booking link"
            variant="primary"
          />
        )
      )}
    </HydratedMain>
  );
}
