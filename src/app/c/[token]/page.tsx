import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { readCustomerPortal } from "@/domain/customer-portal";
import { formatPhone } from "@/lib/phone-format";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const p = await readCustomerPortal(token, ip);
  if (!p) notFound();
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      timeZone: p.shop.timezone || "America/Chicago",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      timeZone: p.shop.timezone || "America/Chicago",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const nothing =
    !p.toApprove.length &&
    !p.toPay.length &&
    !p.toSign.length &&
    !p.visits.length;
  const first = p.toPay[0]?.href ?? p.toApprove[0]?.href ?? p.toSign[0]?.href;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p className="muted">{p.shop.name}</p>
      <h1>Hi {p.customer.firstName || p.customer.displayName}</h1>
      {first ? (
        <a className="btn primary" data-page-primary href={first}>
          {p.toPay[0]
            ? `Pay ${formatMoney(p.toPay[0].balanceCents)}`
            : p.toApprove[0]
              ? "Review your estimate"
              : "Review and sign"}
        </a>
      ) : p.bookHref ? (
        <a className="btn primary" data-page-primary href={p.bookHref}>
          Book a visit
        </a>
      ) : null}
      {nothing && <p>You’re all set — nothing needs your attention.</p>}

      {p.toPay.length > 0 && (
        <section className="card" aria-label="To pay">
          <h2>To pay</h2>
          <ul className="row-list">
            {p.toPay.map((i) => (
              <li key={i.id}>
                {i.href ? (
                  <a href={i.href}>
                    <span className="row-main">
                      <strong>{i.title}</strong>
                      <span className="muted">
                        Invoice #{i.number} · {date(i.createdAt)}
                      </span>
                    </span>
                    <strong className="row-side">
                      {formatMoney(i.balanceCents)}
                    </strong>
                  </a>
                ) : (
                  <div>
                    <span className="row-main">
                      <strong>{i.title}</strong>
                      <span className="muted">
                        Call the shop for a new pay link.
                      </span>
                    </span>
                    <strong className="row-side">
                      {formatMoney(i.balanceCents)}
                    </strong>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.toApprove.length > 0 && (
        <section className="card" aria-label="To approve">
          <h2>Estimates to review</h2>
          <ul className="row-list">
            {p.toApprove.map((e) => (
              <li key={e.id}>
                <a href={e.href ?? "#"}>
                  <span className="row-main">
                    <strong>{e.title}</strong>
                    <span className="muted">
                      Good until {date(e.expiresAt)}
                    </span>
                  </span>
                  <strong className="row-side">
                    {formatMoney(e.totalCents)}
                  </strong>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.toSign.length > 0 && (
        <section className="card" aria-label="To sign">
          <h2>To sign</h2>
          <ul className="row-list">
            {p.toSign.map((d) => (
              <li key={d.id}>
                <a href={d.href ?? "#"}>
                  <span className="row-main">
                    <strong>{d.title}</strong>
                  </span>
                  <span className="row-side">Review and sign</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.visits.length > 0 && (
        <section className="card" aria-label="Upcoming visits">
          <h2>Upcoming visits</h2>
          <ul className="row-list">
            {p.visits.map((v) => (
              <li key={v.startsAt}>
                <div>
                  <span className="row-main">
                    <strong>{when(v.startsAt)}</strong>
                    {v.reason && <span className="muted">{v.reason}</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(p.approved.length > 0 || p.paid.length > 0) && (
        <section className="card" aria-label="History">
          <h2>History</h2>
          <ul className="row-list">
            {p.paid.map((i) => (
              <li key={i.id}>
                <a href={i.href ?? "#"}>
                  <span className="row-main">
                    <strong>{i.title}</strong>
                    <span className="muted">
                      Paid · Invoice #{i.number} · {date(i.createdAt)}
                    </span>
                  </span>
                  <span className="row-side">{formatMoney(i.totalCents)}</span>
                </a>
              </li>
            ))}
            {p.approved.map((e) => (
              <li key={e.id}>
                <a href={e.href ?? "#"}>
                  <span className="row-main">
                    <strong>{e.title}</strong>
                    <span className="muted">
                      Approved · {date(e.createdAt)}
                    </span>
                  </span>
                  <span className="row-side">{formatMoney(e.totalCents)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="muted">
        Questions?{" "}
        {p.shop.phone ? (
          <a href={`tel:${p.shop.phone}`}>Call {formatPhone(p.shop.phone)}</a>
        ) : (
          "Contact the shop."
        )}
        {p.bookHref && (
          <>
            {" "}
            · <a href={p.bookHref}>Book another visit</a>
          </>
        )}
      </p>
    </HydratedMain>
  );
}
