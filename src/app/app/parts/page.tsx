import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { WorkNavigation } from "@/components/work-navigation";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import { getPart, listParts, stockHistory } from "@/domain/parts";
import { isAutomotive } from "@/lib/business-types";
import {
  archivePartAction,
  countStockAction,
  receiveStockAction,
  savePartAction,
} from "@/server/actions/parts";
import { requireShopSession } from "@/server/views/shop";

const qty = (h: number) =>
  (h / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const REASONS: Record<string, string> = {
  received: "Received",
  used: "Used on invoice",
  returned: "Back from voided invoice",
  counted: "Shelf count",
};

export default async function PartsPage(props: {
  searchParams: Promise<{
    q?: string;
    part?: string;
    new?: string;
    edit?: string;
  }>;
}) {
  const { q, part: partId, new: creating, edit } = await props.searchParams;
  const s = await requireShopSession("/app/parts");
  const data = await withTenant(s.businessId, s.actor, async (tx) => {
    const id = edit ?? partId;
    const part = id ? await getPart(tx, id) : null;
    return {
      profile: await getBusinessProfile(tx),
      parts: part || creating ? [] : await listParts(tx, q ?? ""),
      part,
      history: part && !edit ? await stockHistory(tx, part.id) : [],
    };
  });
  const type = data.profile?.businessType ?? "automotive";
  const auto = isAutomotive(type);
  const noun = auto ? "part" : "material";
  const title = auto ? "Parts" : "Materials";
  const canEdit = s.actor.type !== "support";
  const p = data.part;

  if (creating || (edit && p))
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <p>
          <Link href={p ? `/app/parts?part=${p.id}` : "/app/parts"}>
            ← Back
          </Link>
        </p>
        <h1>{p ? `Edit ${p.name}` : `Add a ${noun}`}</h1>
        <section className="card part-form">
          <ActionForm
            action={savePartAction}
            hidden={{ id: p?.id ?? "" }}
            submitLabel={p ? "Save changes" : `Add ${noun}`}
            variant="primary"
          >
            <label htmlFor="part-name">Name</label>
            <input
              id="part-name"
              name="name"
              required
              maxLength={200}
              defaultValue={p?.name}
              placeholder={
                auto ? "Front brake pads" : "1/2 in. copper pipe (ft)"
              }
            />
            <label htmlFor="part-number">
              Part number <span className="muted">(optional)</span>
            </label>
            <input
              id="part-number"
              name="partNumber"
              maxLength={100}
              defaultValue={p?.partNumber ?? ""}
            />
            <label htmlFor="part-cost">
              Your cost, each <span className="muted">(optional)</span>
            </label>
            <input
              id="part-cost"
              name="unitCost"
              inputMode="decimal"
              defaultValue={dollars(p?.unitCostCents ?? null)}
            />
            <label htmlFor="part-price">Selling price, each</label>
            <input
              id="part-price"
              name="unitPrice"
              inputMode="decimal"
              required
              defaultValue={dollars(p?.unitPriceCents ?? null)}
            />
            {!p && (
              <>
                <label htmlFor="part-on-hand">How many on the shelf now</label>
                <input
                  id="part-on-hand"
                  name="onHand"
                  inputMode="decimal"
                  defaultValue="0"
                />
              </>
            )}
            <label htmlFor="part-reorder">
              Warn me when it’s down to{" "}
              <span className="muted">(optional)</span>
            </label>
            <input
              id="part-reorder"
              name="reorderAt"
              inputMode="decimal"
              defaultValue={
                p?.reorderAtHundredths != null ? qty(p.reorderAtHundredths) : ""
              }
            />
          </ActionForm>
        </section>
      </HydratedMain>
    );

  if (p)
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <p>
          <Link href="/app/parts">← {title}</Link>
        </p>
        <h1>{p.name}</h1>
        <p className="stat-strip" aria-label="Stock">
          <span className={p.low ? "count-warn" : undefined}>
            <strong>{qty(p.onHandHundredths)}</strong> on the shelf
            {p.low && " — time to reorder"}
          </span>
          <span>
            <strong>{formatMoney(p.unitPriceCents)}</strong> each
          </span>
          {p.unitCostCents !== null && (
            <span>
              <strong>{formatMoney(p.unitCostCents)}</strong> your cost
            </span>
          )}
          {p.partNumber && <span>#{p.partNumber}</span>}
        </p>
        {canEdit && (
          <div className="part-actions">
            <section className="card" aria-label="Receive stock">
              <h2>Parts came in</h2>
              <ActionForm
                action={receiveStockAction}
                hidden={{ partItemId: p.id }}
                submitLabel="Add to stock"
                variant="primary"
              >
                <label htmlFor="recv-qty">How many</label>
                <input
                  id="recv-qty"
                  name="quantity"
                  inputMode="decimal"
                  required
                />
                <label htmlFor="recv-cost">
                  Cost each this time <span className="muted">(optional)</span>
                </label>
                <input
                  id="recv-cost"
                  name="unitCost"
                  inputMode="decimal"
                  placeholder={dollars(p.unitCostCents)}
                />
              </ActionForm>
            </section>
            <section className="card" aria-label="Shelf count">
              <h2>Count the shelf</h2>
              <ActionForm
                action={countStockAction}
                hidden={{ partItemId: p.id }}
                submitLabel="Save count"
                variant="secondary"
              >
                <label htmlFor="count-qty">How many are there</label>
                <input
                  id="count-qty"
                  name="counted"
                  inputMode="decimal"
                  required
                  defaultValue={qty(p.onHandHundredths)}
                />
              </ActionForm>
            </section>
          </div>
        )}
        <section className="card" aria-label="Stock history">
          <h2>History</h2>
          {!data.history.length && <p className="muted">No changes yet.</p>}
          <ul className="stock-history">
            {data.history.map((h) => (
              <li key={h.id}>
                <span>
                  {REASONS[h.reason] ?? h.reason}
                  <span className="muted">
                    {" "}
                    · {h.createdAt.toLocaleDateString("en-US")}
                  </span>
                </span>
                <strong>
                  {h.changeHundredths > 0 ? "+" : ""}
                  {qty(h.changeHundredths)}
                </strong>
              </li>
            ))}
          </ul>
        </section>
        {canEdit && (
          <div className="part-footer">
            <Link className="btn secondary" href={`/app/parts?edit=${p.id}`}>
              Edit {noun}
            </Link>
            <ActionForm
              action={archivePartAction}
              hidden={{ partItemId: p.id }}
              submitLabel={`Remove ${noun}`}
              confirm={`Remove ${p.name} from your list? Past jobs keep it.`}
              variant="danger"
            />
          </div>
        )}
      </HydratedMain>
    );

  const low = data.parts.filter((x) => x.low).length;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>{title}</h1>
      <WorkNavigation current="parts" businessType={type} />
      {canEdit && (
        <Link className="btn primary" data-page-primary href="/app/parts?new=1">
          + Add {noun}
        </Link>
      )}
      <form method="get" className="search-form inline-search" role="search">
        <label htmlFor="q">Find a {noun}</label>
        <div className="search-controls">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={100}
            placeholder="Name or part number"
          />
          <button className="btn secondary">Search</button>
        </div>
      </form>
      {low > 0 && (
        <p className="notice" role="status">
          {low} {low === 1 ? noun : `${noun}s`} running low — shown first.
        </p>
      )}
      {data.parts.length ? (
        <ul className="row-list card" aria-label={`${title} list`}>
          {data.parts.map((x) => (
            <li key={x.id}>
              <Link href={`/app/parts?part=${x.id}`} aria-label={x.name}>
                <span className="row-main">
                  <strong>{x.name}</strong>
                  <span className="muted">
                    {[
                      x.partNumber && `#${x.partNumber}`,
                      `${formatMoney(x.unitPriceCents)} each`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className={x.low ? "row-side count-warn" : "row-side"}>
                  {qty(x.onHandHundredths)} on hand
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-records">
          <h2>{q ? `No matching ${noun}s` : `No ${noun}s yet`}</h2>
          <p className="muted">
            {q
              ? "Try a different name or part number."
              : `Add the ${noun}s you use most. Pick them on a job and the shelf count goes down when you invoice.`}
          </p>
        </div>
      )}
    </HydratedMain>
  );
}
