import { reminderHistory } from "@/domain/payment-reminders";
import { sendReminderAction } from "@/server/actions/payment-reminders";
import { InvoiceDesigner } from "@/components/invoice-designer";
import { getInvoiceTemplate } from "@/domain/invoice-display";
import { HydratedMain } from "@/components/hydrated-main";
import { z } from "zod";
import { notFound } from "next/navigation";
import { localDateKey, formatDateOnly } from "@/lib/timezone";
import { getBusinessProfile } from "@/domain/business-profile";
import { WorkNavigation } from "@/components/work-navigation";
import Link from "next/link";
import { StripeButton, StripeRefundForm } from "@/components/stripe-controls";
import { invoiceCheckout, invoiceRefund, estimateVersion } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { activeCheckoutStates } from "@/domain/payments";
import { withTenant } from "@/db/tenant";
import { listEstimates } from "@/domain/estimates";
import { listInvoices } from "@/domain/invoices";
import { requireShopSession } from "@/server/views/shop";
import {
  InvoiceIssuer,
  InvoiceLink,
  InvoicePaymentForm,
} from "@/components/invoice-controls";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import {
  setInvoiceDisputeAction,
  reverseInvoicePaymentAction,
  voidInvoiceAction,
} from "@/server/actions/invoices";
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    versionId?: string;
    invoiceId?: string;
  }>;
}) {
  const params = await searchParams;
  if (
    (params.versionId && !z.uuid().safeParse(params.versionId).success) ||
    (params.invoiceId && !z.uuid().safeParse(params.invoiceId).success)
  )
    notFound();
  const s = await requireShopSession("/app/invoices");
  const data = await withTenant(s.businessId, s.actor, async (tx) => {
    const [requested] = params.versionId
      ? await tx
          .select({ quoteId: estimateVersion.quoteId })
          .from(estimateVersion)
          .where(
            and(
              eq(estimateVersion.businessId, tx.businessId),
              eq(estimateVersion.id, params.versionId),
            ),
          )
      : [];
    return {
      profile: await getBusinessProfile(tx),
      template: await getInvoiceTemplate(tx),
      invoices: await listInvoices(tx, params.invoiceId),
      reminders: params.invoiceId
        ? await reminderHistory(tx, params.invoiceId)
        : [],
      estimates: await listEstimates(tx, requested?.quoteId),
      checkouts: await tx
        .select()
        .from(invoiceCheckout)
        .where(
          and(
            eq(invoiceCheckout.businessId, tx.businessId),
            inArray(invoiceCheckout.status, activeCheckoutStates),
          ),
        ),
      refunds: await tx
        .select()
        .from(invoiceRefund)
        .where(eq(invoiceRefund.businessId, tx.businessId)),
    };
  });
  if (params.invoiceId && !data.invoices.length) notFound();
  const choices = data.estimates
    .filter(
      (e, i, a) =>
        a.findIndex((x) => x.quoteId === e.quoteId) === i &&
        e.authorization &&
        e.authorization.approvedLineIds.length > 0 &&
        !data.invoices.some(
          (inv) => inv.quoteId === e.quoteId && !inv.voidedAt,
        ),
    )
    .map((e) => ({
      id: e.id,
      jobId: e.quoteId,
      label: `${e.snapshot.title} · ${e.snapshot.customerName}`,
    }));
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Invoices</h1>
      <WorkNavigation
        current="invoices"
        businessType={data.profile?.businessType}
      />
      {params.new !== "1" && !params.invoiceId && (
        <Link
          className="btn primary"
          data-page-primary
          href="/app/invoices?new=1"
        >
          Create invoice
        </Link>
      )}
      <p className="muted">
        Record cash, checks, transfers, and verified online payments.
      </p>
      <details>
        <summary>Payment settings & status</summary>{" "}
        <p>
          <Link href="/app/settings/payments">Online payment setup</Link>
        </p>
        {Boolean(process.env.STRIPE_SECRET_KEY) &&
          s.actor.type !== "support" && <StripeButton kind="reconcile" />}
      </details>
      {params.new === "1" && (
        <>
          <p>
            <Link href="/app/invoices">← All invoices</Link>
          </p>
          <InvoiceIssuer
            today={localDateKey(
              new Date(),
              data.profile?.timezone ?? "America/Chicago",
            )}
            key={params.versionId ?? "new"}
            choices={choices}
            initialVersionId={
              choices.some((c) => c.id === params.versionId)
                ? params.versionId
                : undefined
            }
          />
        </>
      )}
      {params.new !== "1" && (
        <h2>{params.invoiceId ? "Invoice details" : "Issued invoices"}</h2>
      )}
      {params.new !== "1" && !data.invoices.length && (
        <p>No invoices issued yet.</p>
      )}
      {data.invoices
        .filter(
          (i) =>
            params.new !== "1" &&
            (!params.invoiceId || i.id === params.invoiceId),
        )
        .map((i) => (
          <article className="card" key={i.id} id={`invoice-${i.id}`}>
            <h2>
              Invoice #{i.number} · {i.snapshot.title}
            </h2>
            <p>
              {i.snapshot.customerName} ·{" "}
              {i.snapshot.serviceLabel || i.snapshot.vehicleLabel}
            </p>
            <p>
              <strong>
                {i.voidedAt
                  ? "Void"
                  : i.balanceCents === 0
                    ? "Paid"
                    : i.paidCents > 0
                      ? "Partially paid"
                      : "Payment due"}
              </strong>
            </p>
            <p>
              Total: {formatMoney(i.totalCents)} · Paid:{" "}
              {formatMoney(i.paidCents)} · Balance:{" "}
              <strong>{formatMoney(i.voidedAt ? 0 : i.balanceCents)}</strong>
            </p>
            <p>
              Due:{" "}
              {i.dueOn
                ? formatDateOnly(i.dueOn)
                : i.invoiceTerms.startsWith("Due on receipt.")
                  ? "On receipt"
                  : "Not specified — see invoice terms"}
            </p>
            <Link href={`/app/jobs?job=${i.quoteId}`}>
              Job timeline, authorization &amp; work remaining
            </Link>
            {params.invoiceId === i.id && !i.voidedAt && i.balanceCents > 0 && (
              <section className="reminder-box" aria-label="Payment reminders">
                {s.actor.type !== "support" && (
                  <ActionForm
                    action={sendReminderAction}
                    hidden={{ invoiceId: i.id }}
                    submitLabel="Email a payment reminder"
                    variant="secondary"
                  />
                )}
                {data.reminders.length > 0 && (
                  <ul className="reminder-log muted">
                    {data.reminders.map((r) => (
                      <li key={r.id}>
                        {r.status === "sent"
                          ? "Reminder sent"
                          : "Couldn’t send"}{" "}
                        to {r.sentTo} ·{" "}
                        {r.createdAt.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                        {r.automatic ? " (automatic)" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {i.voidReason && <p>Void reason: {i.voidReason}</p>}
            <section className="record-details" id="preview">
              <InvoiceDesigner
                invoiceId={i.id}
                invoice={{
                  number: i.number,
                  snapshot: i.snapshot,
                  issuedAt: i.createdAt,
                  dueOn: i.dueOn,
                  terms: i.invoiceTerms,
                  voided: !!i.voidedAt,
                  totalCents: i.totalCents,
                  paidCents: i.paidCents,
                }}
                template={data.template}
                override={i.display}
                canSaveDefault={
                  s.role === "owner" && s.actor.type !== "support"
                }
              />
            </section>
            <details
              className="record-details"
              open={params.invoiceId === i.id}
            >
              <summary>View invoice &amp; payments</summary>
              <InvoiceLink id={i.id} />
              {i.disputeOpen && (
                <p className="notice">
                  Open dispute: {i.disputeOpen}. Follow-ups follow-up is paused.
                </p>
              )}
              {!i.voidedAt && s.actor.type !== "support" && (
                <details>
                  <summary>Customer has a billing question</summary>
                  <p>
                    Record disputes reported to the shop here. Clear the reason
                    after resolution. This pauses Follow-ups follow-up and does
                    not move money or change Stripe dispute handling.
                  </p>
                  <ActionForm
                    action={setInvoiceDisputeAction}
                    hidden={{ id: i.id }}
                    submitLabel="Save billing note"
                    variant="secondary"
                  >
                    <label htmlFor={`dispute-${i.id}`}>
                      Billing question (clear when resolved)
                    </label>
                    <input
                      id={`dispute-${i.id}`}
                      name="reason"
                      maxLength={1000}
                      defaultValue={i.disputeOpen ?? ""}
                    />
                  </ActionForm>
                </details>
              )}
              <h3>Payment history</h3>
              {!i.entries.length && <p>No payments recorded.</p>}
              {i.entries.map((p) => (
                <div key={p.id}>
                  <p>
                    {formatMoney(p.amountCents)} ·{" "}
                    {p.method.replaceAll("_", " ")} ·{" "}
                    {p.createdAt.toLocaleString("en-US", {
                      timeZone: "America/Chicago",
                    })}
                  </p>
                  {p.reference && <p>Reference: {p.reference}</p>}
                  {p.reason && <p>Reason: {p.reason}</p>}
                  {s.role === "owner" &&
                    !i.voidedAt &&
                    p.amountCents > 0 &&
                    p.method !== "stripe" &&
                    !i.entries.some((e) => e.reversesPaymentId === p.id) && (
                      <details>
                        <summary>Correct this entry</summary>
                        <ActionForm
                          action={reverseInvoicePaymentAction}
                          hidden={{ paymentId: p.id }}
                          submitLabel="Reverse recorded entry"
                          variant="danger"
                          confirm="Reverse this bookkeeping entry? This does not refund or move money."
                        >
                          <label htmlFor={`reason-${p.id}`}>
                            Correction reason
                          </label>
                          <input
                            id={`reason-${p.id}`}
                            name="reason"
                            required
                            maxLength={1000}
                          />
                        </ActionForm>
                      </details>
                    )}
                  {s.role === "owner" &&
                    s.actor.type !== "support" &&
                    p.method === "stripe" &&
                    p.amountCents +
                      i.entries
                        .filter((e) => e.reversesPaymentId === p.id)
                        .reduce((n, e) => n + e.amountCents, 0) >
                      0 &&
                    !data.refunds.some(
                      (r) =>
                        r.paymentId === p.id &&
                        ["creating", "pending"].includes(r.status),
                    ) && (
                      <details>
                        <summary>Refund through Stripe</summary>
                        <StripeRefundForm
                          paymentId={p.id}
                          maxCents={
                            p.amountCents +
                            i.entries
                              .filter((e) => e.reversesPaymentId === p.id)
                              .reduce((n, e) => n + e.amountCents, 0)
                          }
                        />
                      </details>
                    )}
                </div>
              ))}
              {data.checkouts.some((c) => c.invoiceId === i.id) && (
                <p role="status">
                  An online payment attempt is open or processing. Refresh
                  payment status before recording a manual payment or voiding
                  this invoice.
                </p>
              )}
              {s.role === "owner" &&
                s.actor.type !== "support" &&
                data.checkouts
                  .filter((c) => c.invoiceId === i.id && c.sessionId)
                  .map((c) => (
                    <StripeButton key={c.id} kind="cancel" checkoutId={c.id} />
                  ))}
              {data.refunds
                .filter((r) => r.invoiceId === i.id)
                .map((r) => (
                  <div key={r.id}>
                    Refund: {formatMoney(r.amountCents)} · {r.status} ·{" "}
                    {r.reason}
                    {s.role === "owner" &&
                      s.actor.type !== "support" &&
                      ["creating", "pending"].includes(r.status) && (
                        <StripeButton kind="retry-refund" checkoutId={r.id} />
                      )}
                  </div>
                ))}
              {!i.voidedAt &&
                i.balanceCents > 0 &&
                !data.checkouts.some((c) => c.invoiceId === i.id) &&
                !data.refunds.some(
                  (r) =>
                    r.invoiceId === i.id &&
                    ["creating", "pending"].includes(r.status),
                ) && (
                  <InvoicePaymentForm id={i.id} balanceCents={i.balanceCents} />
                )}{" "}
              {s.role === "owner" &&
                !i.voidedAt &&
                i.paidCents === 0 &&
                !data.checkouts.some((c) => c.invoiceId === i.id) && (
                  <details>
                    <summary>Void invoice</summary>
                    <ActionForm
                      action={voidInvoiceAction}
                      hidden={{ id: i.id }}
                      submitLabel="Void invoice"
                      variant="danger"
                      confirm="Void this invoice permanently? Its history remains."
                    >
                      <label htmlFor={`void-${i.id}`}>Void reason</label>
                      <input
                        id={`void-${i.id}`}
                        name="reason"
                        required
                        maxLength={1000}
                      />
                    </ActionForm>
                  </details>
                )}
            </details>
          </article>
        ))}
    </HydratedMain>
  );
}
