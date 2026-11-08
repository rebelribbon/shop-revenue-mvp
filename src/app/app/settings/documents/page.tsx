import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { TemplateEditor } from "@/components/template-editor";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import { MERGE_FIELDS, listTemplates } from "@/domain/documents";
import {
  addStarterTemplatesAction,
  archiveTemplateAction,
} from "@/server/actions/documents";
import { requireOwnerView } from "@/server/views/shop";

export default async function DocumentTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string; saved?: string }>;
}) {
  const s = await requireOwnerView("/app/settings/documents");
  const p = await searchParams;
  const { templates, profile } = await withTenant(
    s.businessId,
    s.actor,
    async (tx) => ({
      templates: await listTemplates(tx),
      profile: await getBusinessProfile(tx),
    }),
  );
  const editing = templates.find((t) => t.id === p.edit);
  const readOnly = s.actor.type === "support";
  const shop = profile?.dba || profile?.legalName || "Your business";
  const sample: Record<string, string> = {
    customer_name: "Pat Smith",
    customer_address: "12 Oak St, Austin, TX 78701",
    customer_phone: "(512) 555-0100",
    customer_email: "pat@example.com",
    job_title: "Replace deck boards",
    job_location: "Smith house, 12 Oak St",
    job_total: "$1,250.00",
    shop_name: shop,
    shop_phone: profile?.phoneE164 ?? "(555) 555-0100",
    shop_address: profile?.addressLine1 ?? "123 Main St",
    today: new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Documents</h1>
      <p>
        Create agreements and waivers for the customer to review and sign. Your shop defines all work and prices. Change orders use the published revised estimate; the customer only acknowledges the changes and signs.
      </p>
      {p.saved && (
        <p role="status" className="notice ok">
          Document saved.
        </p>
      )}
      {editing || p.new === "1" ? (
        <>
          <TemplateEditor
            template={editing}
            mergeFields={MERGE_FIELDS}
            sample={sample}
          />
          <p>
            <Link href="/app/settings/documents">Back to documents</Link>
          </p>
        </>
      ) : (
        <>
          {!readOnly && (
            <Link
              href="/app/settings/documents?new=1"
              className="btn primary"
              data-page-primary
            >
              + New document
            </Link>
          )}
          {!templates.length && (
            <section className="card">
              <h2>Start with ready-made documents</h2>
              <p>
                Work authorization, shop-priced change order and liability waiver. You can edit the wording; customer signatures do not change prices.
              </p>
              {!readOnly && (
                <ActionForm
                  action={addStarterTemplatesAction}
                  submitLabel="Add the starter documents"
                  variant="secondary"
                />
              )}
            </section>
          )}
          {templates.map((t) => (
            <section className="card" key={t.id}>
              <h2>{t.name}</h2>
              <p className="muted">
                {t.fields.length} blank{t.fields.length === 1 ? "" : "s"} +
                signature
              </p>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {t.body.length > 240 ? `${t.body.slice(0, 240)}…` : t.body}
              </p>
              {!readOnly && (
                <div className="money-actions">
                  <Link
                    className="btn secondary"
                    href={`/app/settings/documents?edit=${t.id}`}
                  >
                    Edit
                  </Link>
                  <ActionForm
                    action={archiveTemplateAction}
                    hidden={{ templateId: t.id }}
                    submitLabel="Remove"
                    variant="danger"
                    confirm={`Remove ${t.name}? Documents already sent keep their text.`}
                  />
                </div>
              )}
            </section>
          ))}
        </>
      )}
      <p>
        <Link href="/app/settings">Back to settings</Link>
      </p>
    </HydratedMain>
  );
}
