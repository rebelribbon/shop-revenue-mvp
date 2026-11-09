import type { ReactNode } from "react";
import Link from "next/link";

export function RecordSection({
  title,
  description,
  count,
  actions,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`record-section ${className}`} aria-label={title}>
      <header className="record-section-header">
        <div>
          <h2>
            {title}
            {count !== undefined && (
              <span className="record-count">{count}</span>
            )}
          </h2>
          {description && <p className="muted">{description}</p>}
        </div>
        {actions && <div className="record-section-actions">{actions}</div>}
      </header>
      <div className="record-section-body">{children}</div>
    </section>
  );
}

export function WorkCard({
  href,
  reference,
  title,
  customer,
  detail,
  status,
  statusClass = "pill",
  amount,
  amountLabel = "Estimate",
  ariaLabel,
  nextAction,
}: {
  href: string;
  reference: string;
  title: string;
  customer?: string;
  detail?: string;
  status: string;
  statusClass?: string;
  amount?: string;
  amountLabel?: string;
  ariaLabel?: string;
  nextAction?: { label: string; href: string };
}) {
  const record = (
    <Link href={href} className="record-work-card" aria-label={ariaLabel}>
      <span className="record-work-top">
        <span className="record-work-reference">{reference}</span>
        <span className={statusClass}>{status}</span>
      </span>
      <strong className="record-work-title">{title}</strong>
      {customer && <span className="record-work-customer">{customer}</span>}
      {detail && <span className="muted">{detail}</span>}
      <span className="record-work-bottom">
        {amount && (
          <span>
            <span className="muted">{amountLabel}</span>
            <strong>{amount}</strong>
          </span>
        )}
        {!nextAction && (
          <span className="record-open">
            Open {reference.startsWith("RO") ? "RO" : "job"}
            <span aria-hidden="true"> →</span>
          </span>
        )}
      </span>
    </Link>
  );
  if (!nextAction) return record;
  return (
    <article className="record-work-with-action">
      {record}
      <div className="record-work-action">
        <Link href={nextAction.href} className="btn secondary">
          {nextAction.label}
        </Link>
      </div>
    </article>
  );
}
