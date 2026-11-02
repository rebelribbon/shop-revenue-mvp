import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { InvoiceDesigner } from "@/components/invoice-designer";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import { getInvoiceTemplate } from "@/domain/invoice-display";
import { requireOwnerView } from "@/server/views/shop";

export default async function InvoiceLayoutSettings() {
  const s = await requireOwnerView("/app/settings/invoices");
  const { template, profile } = await withTenant(
    s.businessId,
    s.actor,
    async (tx) => ({
      template: await getInvoiceTemplate(tx),
      profile: await getBusinessProfile(tx),
    }),
  );
  const shopName = profile?.dba || profile?.legalName || "Your business";
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Invoice layout</h1>
      <p>
        Turn on what you want customers to see. Every new invoice starts this
        way, and you can still change a single invoice before you send it.
        Totals, sales tax and the balance due always show.
      </p>
      <InvoiceDesigner
        defaultOnly
        canSaveDefault={s.actor.type !== "support"}
        template={template}
        override={null}
        invoice={{
          number: 1042,
          issuedAt: new Date(),
          dueOn: null,
          terms: "Due on receipt. Sample terms appear here.",
          voided: false,
          totalCents: 34485,
          paidCents: 10000,
          snapshot: {
            title: "Sample job: replace deck boards",
            shopName,
            shopPhone: profile?.phoneE164 ?? "(555) 555-0100",
            shopAddress:
              [profile?.addressLine1, profile?.city, profile?.region]
                .filter(Boolean)
                .join(", ") || "123 Main St, Your City",
            customerName: "Sample Customer",
            vehicleLabel: "",
            serviceLabel: "Smith house, 12 Oak St",
            lines: [
              {
                id: "part-0",
                description: "Deck boards",
                kind: "part",
                quantity: 12,
                unitPriceCents: 1500,
                totalCents: 18000,
                taxable: true,
              },
              {
                id: "labor-0",
                description: "Install labor",
                kind: "labor",
                quantity: 2,
                unitPriceCents: 7500,
                totalCents: 15000,
                taxable: false,
              },
            ],
            subtotalCents: 33000,
            taxBps: 825,
            taxCents: 1485,
            totalCents: 34485,
            terms: "",
          },
        }}
      />
      <p>
        <Link href="/app/settings">Back to settings</Link>
      </p>
    </HydratedMain>
  );
}
