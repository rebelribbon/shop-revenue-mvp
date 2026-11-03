import { notFound } from "next/navigation";
import { BookingForm } from "@/components/booking-form";
import { HydratedMain } from "@/components/hydrated-main";
import { readBooking } from "@/domain/booking";
import { isAutomotive } from "@/lib/business-types";
import { formatPhone } from "@/lib/phone-format";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Book a visit",
  robots: { index: false, follow: false },
};

export default async function BookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const shop = await readBooking(slug);
  if (!shop) notFound();
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p className="muted">{shop.name}</p>
      <h1>Book a visit</h1>
      <p>
        Tell us what you need and we’ll call you to set a time.
        {shop.phone && (
          <>
            {" "}
            In a hurry? Call{" "}
            <a href={`tel:${shop.phone}`}>{formatPhone(shop.phone)}</a>.
          </>
        )}
      </p>
      <BookingForm slug={slug} automotive={isAutomotive(shop.businessType)} />
    </HydratedMain>
  );
}
