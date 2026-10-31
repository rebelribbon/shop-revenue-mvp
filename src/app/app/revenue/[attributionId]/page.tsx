import Link from "next/link";
import { withTenant } from "@/db/tenant";
import { revenueDetail } from "@/domain/revenue";
import type { RevenueDecision } from "@/domain/revenue-rules";
import { requireShopSession } from "@/server/views/shop";
import { revenueMoney } from "@/components/revenue-summary";
import { ActionForm } from "@/components/action-form";
import { reviewRevenueAction } from "@/server/actions/revenue";
export default async function AttributionPage({
  params,
}: {
  params: Promise<{ attributionId: string }>;
}) {
  const s = await requireShopSession("/app/revenue"),
    { attributionId } = await params;
  const data = await withTenant(s.businessId, s.actor, (tx) =>
    revenueDetail(tx, attributionId),
  );
  const decision = data.row.decision as RevenueDecision;
  const date = (d: Date) =>
    d.toLocaleString("en-US", {
      timeZone: data.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
  return (
    <main id="main-content" tabIndex={-1}>
      <p>
        <Link href="/app/revenue">← Recovered revenue</Link>
      </p>
      <h1>Invoice #{data.invoice.number} · attribution</h1>
      <section className="card">
        <h2>
          {data.row.classification === "direct"
            ? "Directly recovered"
            : data.row.classification === "influenced"
              ? "Influenced — not recovered"
              : "No current credit"}
          : {revenueMoney(data.row.amountCents)}
        </h2>
        <p>
          {data.invoice.snapshot.customerName} · {data.invoice.snapshot.title}
        </p>
        <p>{decision.explanation}</p>
        <p>
          Counted invoice lines before tax:{" "}
          {revenueMoney(decision.countedSubtotalCents)}
        </p>
        <p>
          Also on this visit, not counted:{" "}
          {revenueMoney(decision.otherSubtotalCents)}
        </p>
        <p className="muted">
          {data.row.ruleCode} · rules {data.row.ruleVersion} · revision{" "}
          {data.row.revision}. Amount is the counted subtotal’s share of net
          recorded payments, not the original opportunity estimate.
        </p>
        <Link href="/app/invoices">View invoice and payment history</Link>
      </section>
      {s.role === "owner" && s.actor.type !== "support" && (
        <details className="card">
          <summary>
            {data.row.excluded
              ? "Restore evidence evaluation"
              : "Not from this follow-up"}
          </summary>
          <p>
            Correct the attribution without changing the invoice or moving
            money. Every correction remains in the audit history.
          </p>
          <ActionForm
            action={reviewRevenueAction}
            hidden={{
              id: attributionId,
              excluded: data.row.excluded ? "false" : "true",
            }}
            submitLabel={
              data.row.excluded
                ? "Restore attribution evaluation"
                : "Exclude this attribution"
            }
            variant="secondary"
          >
            <label htmlFor="revenue-correction">Correction reason</label>
            <input
              id="revenue-correction"
              name="reason"
              maxLength={900}
              required
            />
          </ActionForm>
        </details>
      )}
      <h2>Recorded contact and response evidence</h2>
      {data.evidence.map((e) => {
        const d = e.data as Record<string, unknown>;
        return (
          <article className="card" key={e.id}>
            <h3>
              {e.kind === "recovery.contact"
                ? "Manual contact"
                : "Customer response"}
            </h3>
            <p>
              {date(e.occurredAt)} ·{" "}
              {String(d.method ?? "owner response").replaceAll("_", " ")}
            </p>
            {typeof d.note === "string" && <p>{d.note}</p>}
            <p>
              {d.deliveryConfirmed === true
                ? "Delivery confirmed by the shop."
                : e.kind === "recovery.contact"
                  ? "Delivery not confirmed."
                  : d.ownerConfirmed === true
                    ? "Response confirmed by the owner."
                    : "Staff note; owner confirmation required for direct credit."}
            </p>
            <p className="muted">Evidence ID: {e.id}</p>
          </article>
        );
      })}
      <h2>Immutable calculation history</h2>
      {data.events.map((e) => {
        const d = e.after as RevenueDecision;
        return (
          <article className="card" key={e.id}>
            <h3>
              Revision {e.revision} · {e.reason}
            </h3>
            <p>{date(e.createdAt)}</p>
            <p>Direct adjustment: {revenueMoney(e.directDeltaCents)}</p>
            <p>Influenced adjustment: {revenueMoney(e.influencedDeltaCents)}</p>
            <p>{d.explanation}</p>
            <details>
              <summary>Calculation references</summary>
              <p>
                Contact: {d.contactId ?? "None"} · Response:{" "}
                {d.responseId ?? "None"}
              </p>
              <p>Counted line IDs: {d.lineIds.join(", ") || "None"}</p>
              <p>Payment / refund IDs: {d.paymentIds.join(", ") || "None"}</p>
              <p>Rule version: {e.ruleVersion}</p>
            </details>
          </article>
        );
      })}
    </main>
  );
}
