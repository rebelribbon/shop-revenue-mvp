import { HydratedMain } from "@/components/hydrated-main";
import { StripeButton } from "@/components/stripe-controls";
import { notFound } from "next/navigation";
import { readPublicInvoice } from "@/domain/invoices";
import { InvoiceDocument } from "@/components/invoice-document";
import { effectiveDisplay } from "@/lib/invoice-display";
import { PrintInvoice } from "@/components/invoice-controls";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Invoice | Shop Revenue",
  robots: { index: false, follow: false },
};
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const i = await readPublicInvoice(token);
  if (!i) notFound();
  const display = effectiveDisplay(i.displayTemplate, i.display);
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Invoice #{i.number}</h1>
      <InvoiceDocument
        invoice={i}
        display={display}
        payment={
          !i.voided &&
          i.paidCents < i.totalCents &&
          (display.payOnline &&
          i.onlinePaymentEnabled &&
          Boolean(
            process.env.STRIPE_SECRET_KEY &&
            process.env.STRIPE_WEBHOOK_SECRET &&
            process.env.PAYMENTS_BASE_URL,
          ) ? (
            <>
              <StripeButton kind="pay" token={token} />
              <p className="muted">
                Payment is confirmed after Stripe verifies it. If you just paid,
                refresh this invoice shortly.
              </p>
            </>
          ) : (
            <p>Contact the shop to arrange payment.</p>
          ))
        }
      />
      <PrintInvoice />
    </HydratedMain>
  );
}
