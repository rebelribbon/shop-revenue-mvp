import { formatPhone } from "@/lib/phone-format";
import { HydratedMain } from "@/components/hydrated-main";
import { ServiceAssets } from "@/components/service-assets";
import { listServiceAssets } from "@/domain/service-assets";
import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive } from "@/lib/business-types";
import { Notes } from "@/components/memory";
import { RememberCustomer } from "@/components/recent-customers";
import { FileUploader } from "@/components/file-uploader";
import {
  ATTACHMENT_CATEGORIES,
  categoryLabel,
  listAttachments,
} from "@/domain/documents";
import { removeDocumentAction } from "@/server/actions/documents";
import type { HistoryItem } from "@/domain/customer-profile";
import { listNotes } from "@/domain/memory";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { VehicleFields } from "@/components/vehicle-fields";
import { withTenant } from "@/db/tenant";
import { getCustomerWithVehicles } from "@/domain/customers";
import {
  customerHistory,
  customerMoney,
  listCustomerJobs,
} from "@/domain/customer-profile";
import { addNoteAction, setNoteHeadsUpAction } from "@/server/actions/memory";
import { formatMoney } from "@/components/estimate-document";
import { cadenceText } from "@/lib/service-plans";
import {
  JOB_FILTERS,
  jobFilter,
  jobStatusLabels,
  statusTone,
} from "@/lib/job-status";
import {
  archiveCustomerAction,
  createVehicleAction,
  updateCustomerAction,
} from "@/server/actions/customers";
import { requireShopSession } from "@/server/views/shop";
import { ContactPermissions } from "@/components/contact-permissions";

export default async function CustomerDetailPage(props: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ view?: string; jobs?: string; add?: string }>;
}) {
  const { customerId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}`);
  const [data, history, notes, profile, assets, jobs, money, attachments] =
    await withTenant(s.businessId, s.actor, async (tx) =>
      Promise.all([
        getCustomerWithVehicles(tx, customerId),
        customerHistory(tx, customerId),
        listNotes(tx, customerId),
        getBusinessProfile(tx),
        listServiceAssets(tx, customerId),
        listCustomerJobs(tx, customerId),
        customerMoney(tx, customerId),
        listAttachments(tx, customerId),
      ]),
    );
  const profileNotes = notes.filter((n) => n.kind === "profile");
  const historyNotes = notes.filter((n) => n.kind === "log");
  const statusLabels = jobStatusLabels(profile?.businessType ?? "automotive");
  const filter = jobFilter((await props.searchParams).jobs);
  const shownJobs = jobs.filter((j) =>
    (filter.statuses as readonly string[]).includes(j.status),
  );
  const tz = profile?.timezone || "America/Chicago";
  const address = [
    data.customer.addressLine1,
    data.customer.addressLine2,
    data.customer.city,
    data.customer.region,
    data.customer.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const readOnly = s.actor.type === "support";
  const c = data.customer;
  const { view: requestedView, add: adding } = await props.searchParams;
  const view = ["assets", "history", "details", "files"].includes(
    requestedView ?? "",
  )
    ? requestedView!
    : "jobs";
  const auto = isAutomotive(profile?.businessType ?? "automotive");
  const base = `/app/customers/${customerId}`;
  const permissions = (
    <ContactPermissions
      customerId={customerId}
      hasPhone={Boolean(c.phoneE164)}
      hasEmail={Boolean(c.email)}
      textOptedOutAt={c.textOptedOutAt}
      emailOptedOutAt={c.emailOptedOutAt}
      doNotContact={c.doNotContact}
      timeZone={profile?.timezone || "America/Chicago"}
      canEdit={s.actor.type !== "support"}
    />
  );
  const assetCount = data.vehicles.length + assets.length;

  const when = (d: Date) =>
    d.toLocaleDateString("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const tabs = [
    ["jobs", `Jobs${jobs.length ? ` (${jobs.length})` : ""}`],
    ["history", "History"],
    ["assets", auto ? "Vehicles" : "Properties"],
    ["files", `Files${attachments.length ? ` (${attachments.length})` : ""}`],
    ["details", "Details"],
  ] as const;

  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <RememberCustomer id={customerId} name={c.displayName} />
      <p>
        <Link href="/app/customers">← Customers</Link>
      </p>
      <div className="profile-layout">
        <aside className="card profile-card">
          <header className="profile-head">
            <div>
              <h1 className="profile-title">{c.displayName}</h1>
              <p className="profile-meta">
                {[
                  address ? (
                    <a
                      key="a"
                      href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {address}
                    </a>
                  ) : null,
                  c.phoneE164
                    ? `${formatPhone(c.phoneE164)}${c.textOptedOutAt ? " (no texts)" : ""}`
                    : null,
                  c.email
                    ? `${c.email}${c.emailOptedOutAt ? " (no emails)" : ""}`
                    : null,
                  `customer since ${c.createdAt.toLocaleDateString("en-US", { timeZone: tz, month: "short", year: "numeric" })}`,
                ]
                  .filter(Boolean)
                  .map((part, i) => (
                    <span key={i}>{part}</span>
                  ))}
              </p>
            </div>
            {(c.phoneE164 || c.email) && (
              <div className="money-actions">
                {c.phoneE164 && (
                  <a className="btn secondary" href={`tel:${c.phoneE164}`}>
                    Call
                  </a>
                )}
                {c.phoneE164 && !c.textOptedOutAt && (
                  <a className="btn secondary" href={`sms:${c.phoneE164}`}>
                    Text
                  </a>
                )}
                {c.email && !c.emailOptedOutAt && (
                  <a className="btn secondary" href={`mailto:${c.email}`}>
                    Email
                  </a>
                )}
              </div>
            )}
          </header>
          {profileNotes.map((n) =>
            n.headsUp ? (
              <p className="heads-up-line" role="note" key={n.id} data-heads-up>
                ⚠ {n.body}
              </p>
            ) : (
              <p className="pinned-note" key={n.id}>
                📌 {n.body}
              </p>
            ),
          )}
          {c.notes && <p className="pinned-note">📌 {c.notes}</p>}
          <p className="stat-strip" aria-label="Money">
            <span>
              <strong>{formatMoney(money.owedCents)}</strong> owes you
            </span>
            <span>
              <strong>{formatMoney(money.paidCents)}</strong> paid you, all time
            </span>
          </p>
        </aside>
        <div className="profile-main">
          {!readOnly && (
            <div className="action-bar" role="group" aria-label="Add">
              <Link
                className="btn primary"
                data-page-primary
                href={
                  assetCount
                    ? `/app/jobs?customerId=${customerId}`
                    : `${base}?view=assets`
                }
              >
                {assetCount ? "+ Job" : auto ? "+ Vehicle" : "+ Property"}
              </Link>
              <Link
                className="btn secondary"
                href={`${base}?view=${view}&add=note`}
                aria-current={adding === "note" ? "true" : undefined}
              >
                + Note
              </Link>
              <Link
                className="btn secondary"
                href={`${base}?view=files&add=attachment`}
                aria-current={adding === "attachment" ? "true" : undefined}
              >
                + Attachment
              </Link>
            </div>
          )}
          {adding === "note" && !readOnly && (
            <section className="card add-panel" aria-label="Add a note">
              <h2>Add a note</h2>
              <ActionForm
                action={addNoteAction}
                hidden={{ customerId }}
                submitLabel="Save note"
                variant="primary"
              >
                <fieldset className="chips">
                  <legend>Where should it go?</legend>
                  <label>
                    <input
                      type="radio"
                      name="kind"
                      value="log"
                      defaultChecked
                    />
                    History (what happened)
                  </label>
                  <label>
                    <input type="radio" name="kind" value="profile" />
                    Pin under their info (who they are)
                  </label>
                </fieldset>
                <label htmlFor="new-note">Note</label>
                <textarea
                  id="new-note"
                  name="body"
                  rows={3}
                  required
                  maxLength={5000}
                />
                <label>
                  <input type="checkbox" name="headsUp" />
                  Heads-up: show it as a warning on their jobs and visits
                  (pinned notes only)
                </label>
              </ActionForm>
              <Link href={`${base}?view=${view}`}>Done</Link>
            </section>
          )}
          {adding === "attachment" && !readOnly && (
            <section className="card add-panel" aria-label="Add an attachment">
              <h2>Add an attachment</h2>
              <FileUploader
                customerId={customerId}
                categories={ATTACHMENT_CATEGORIES}
                buttonLabel="Choose file"
              />
              <Link href={`${base}?view=files`}>Done</Link>
            </section>
          )}
          <nav className="section-tabs" aria-label="Customer sections">
            {tabs.map(([key, label]) => (
              <Link
                key={key}
                href={`${base}${key === "jobs" ? "" : `?view=${key}`}`}
                aria-current={view === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          {view === "jobs" && (
            <section aria-label="Jobs" id="jobs">
              {jobs.length > 1 && (
                <div className="chip-links" role="group" aria-label="Show jobs">
                  {JOB_FILTERS.filter(
                    (f) =>
                      f.key === "all" ||
                      jobs.some((j) =>
                        (f.statuses as readonly string[]).includes(j.status),
                      ),
                  ).map((f) => (
                    <Link
                      key={f.key}
                      href={`${base}?jobs=${f.key}`}
                      aria-current={filter.key === f.key ? "true" : undefined}
                    >
                      {f.label}
                    </Link>
                  ))}
                </div>
              )}
              {!jobs.length && (
                <p className="muted">No jobs yet. Tap + Job to quote one.</p>
              )}
              <ul className="row-list">
                {shownJobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/app/jobs?job=${j.id}`}>
                      <span className="row-main">
                        <strong>
                          {j.repeats && "↻ "}
                          {j.title}
                        </strong>
                        <span className="muted">
                          {j.plan && j.plan.status !== "ended"
                            ? cadenceText(j.plan.repeat)
                            : when(j.createdAt)}
                        </span>
                      </span>
                      <span className="row-side">
                        {j.balanceCents > 0 ? (
                          <strong>owes {formatMoney(j.balanceCents)}</strong>
                        ) : (
                          j.amountCents !== null && (
                            <span>
                              {formatMoney(j.amountCents)}
                              {j.plan ? "/visit" : ""}
                            </span>
                          )
                        )}
                        <span className={statusTone(j.status)}>
                          {statusLabels[j.status]}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {view === "history" && (
            <section aria-label="History">
              <ul className="row-list">
                {history.map((e) => (
                  <li key={e.id}>
                    <HistoryRow item={e} timeZone={tz} />
                  </li>
                ))}
              </ul>
              {!history.length && <p className="muted">No history yet.</p>}
              {historyNotes.length > 0 && !readOnly && (
                <details>
                  <summary>Edit or remove history notes</summary>
                  <Notes customerId={customerId} notes={historyNotes} />
                </details>
              )}
            </section>
          )}
          {view === "files" && (
            <section aria-label="Files">
              {!attachments.length && (
                <p className="muted">
                  No files yet. Tap + Attachment to add a license, insurance
                  card or tax-exempt certificate. Only your shop can see these.
                </p>
              )}
              <ul className="row-list">
                {attachments.map((d) => (
                  <li key={d.id}>
                    <div>
                      <a
                        className="row-main"
                        href={`/media/${d.fileId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <strong>📎 {d.title}</strong>
                        <span className="muted">
                          {categoryLabel(d.category)} · {when(d.createdAt)}
                        </span>
                      </a>
                      {!readOnly && (
                        <ActionForm
                          action={removeDocumentAction}
                          hidden={{ documentId: d.id }}
                          submitLabel="Remove"
                          variant="secondary"
                          confirm={`Remove ${d.title}?`}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {view === "details" && (
            <>
              {permissions}
              <div className="card">
                <h2 style={{ marginTop: 0 }}>Customer details</h2>
                <ActionForm
                  variant="primary"
                  action={updateCustomerAction}
                  hidden={{ customerId }}
                  submitLabel="Save customer"
                  successText="Customer updated."
                >
                  <label htmlFor="firstName">First name</label>
                  <input
                    id="firstName"
                    name="firstName"
                    defaultValue={c.firstName}
                    maxLength={100}
                  />
                  <label htmlFor="lastName">Last name</label>
                  <input
                    id="lastName"
                    name="lastName"
                    defaultValue={c.lastName}
                    maxLength={100}
                  />
                  <label htmlFor="phone">Mobile number</label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    defaultValue={formatPhone(c.phoneE164)}
                  />
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={c.email ?? ""}
                  />
                  <label htmlFor="addressLine1">Street address</label>
                  <input
                    id="addressLine1"
                    name="addressLine1"
                    maxLength={200}
                    defaultValue={c.addressLine1 ?? ""}
                    autoComplete="street-address"
                  />
                  <label htmlFor="addressLine2">Apt, suite (optional)</label>
                  <input
                    id="addressLine2"
                    name="addressLine2"
                    maxLength={200}
                    defaultValue={c.addressLine2 ?? ""}
                  />
                  <label htmlFor="city">City</label>
                  <input
                    id="city"
                    name="city"
                    maxLength={100}
                    defaultValue={c.city ?? ""}
                  />
                  <label htmlFor="region">State</label>
                  <input
                    id="region"
                    name="region"
                    maxLength={50}
                    defaultValue={c.region ?? ""}
                  />
                  <label htmlFor="postalCode">ZIP</label>
                  <input
                    id="postalCode"
                    name="postalCode"
                    maxLength={20}
                    defaultValue={c.postalCode ?? ""}
                    inputMode="numeric"
                  />
                  <label htmlFor="notes">Notes</label>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={4}
                    maxLength={5000}
                    defaultValue={c.notes ?? ""}
                  />
                </ActionForm>
                <ActionForm
                  action={archiveCustomerAction}
                  hidden={{ customerId }}
                  submitLabel="Archive customer"
                  variant="danger"
                  confirm="Archive this customer and their active assets? Their history stays in Shop Revenue."
                />
              </div>
            </>
          )}
          {view === "details" && profileNotes.length > 0 && (
            <section className="card" aria-label="Pinned notes">
              <h2>Pinned notes</h2>
              {profileNotes.map((n) => (
                <div className="overview-row" key={n.id}>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                    {n.headsUp ? "⚠ " : "📌 "}
                    {n.body}
                  </p>
                  {!readOnly && (
                    <ActionForm
                      action={setNoteHeadsUpAction}
                      hidden={{
                        customerId,
                        noteId: n.id,
                        headsUp: n.headsUp ? "false" : "true",
                      }}
                      submitLabel={
                        n.headsUp ? "Remove heads-up" : "Make it a heads-up"
                      }
                      variant="secondary"
                    />
                  )}
                </div>
              ))}
              {!readOnly && (
                <Notes customerId={customerId} notes={profileNotes} />
              )}
            </section>
          )}
          {view === "assets" && (
            <>
              {(!isAutomotive(profile?.businessType ?? "automotive") ||
                assets.length > 0) && (
                <ServiceAssets
                  customerId={customerId}
                  assets={assets}
                  readOnly={s.actor.type === "support"}
                />
              )}
              {(isAutomotive(profile?.businessType ?? "automotive") ||
                data.vehicles.length > 0) && (
                <>
                  {data.vehicles.length > 0 && (
                    <ul className="row-list card">
                      {data.vehicles.map((v) => (
                        <li key={v.id}>
                          <Link
                            href={`/app/customers/${customerId}/vehicles/${v.id}`}
                          >
                            <span className="row-main">
                              <strong>
                                {[v.year, v.make, v.model, v.trim]
                                  .filter(Boolean)
                                  .join(" ") || "Vehicle"}
                              </strong>
                              <span className="muted">
                                {[
                                  v.plate && `Plate ${v.plate}`,
                                  v.vin && `VIN ${v.vin}`,
                                ]
                                  .filter(Boolean)
                                  .join(", ") || "No plate or VIN yet"}
                              </span>
                            </span>
                            <span className="row-side muted">
                              {v.mileage == null
                                ? ""
                                : `${v.mileage.toLocaleString()} mi`}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!readOnly &&
                    (data.vehicles.length === 0 || adding === "vehicle" ? (
                      <section
                        className="card add-panel"
                        id="new-vehicle"
                        aria-label="Add a vehicle"
                      >
                        <h2>Add a vehicle</h2>
                        <ActionForm
                          action={createVehicleAction}
                          hidden={{ customerId }}
                          submitLabel="Add vehicle"
                        >
                          <VehicleFields />
                        </ActionForm>
                        {data.vehicles.length > 0 && (
                          <Link href={`${base}?view=assets`}>Done</Link>
                        )}
                      </section>
                    ) : (
                      <p>
                        <Link
                          className="btn secondary"
                          href={`${base}?view=assets&add=vehicle#new-vehicle`}
                        >
                          + Add another vehicle
                        </Link>
                      </p>
                    ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </HydratedMain>
  );
}

function HistoryRow({
  item,
  timeZone,
}: {
  item: HistoryItem;
  timeZone: string;
}) {
  const when = item.at.toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const body = (
    <>
      <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {item.isNote ? (
          <>📝 {item.summary.replace(/^Note: /, "")}</>
        ) : (
          item.summary
        )}
      </span>
      <span className="muted">{when}</span>
    </>
  );
  return item.href ? <Link href={item.href}>{body}</Link> : <div>{body}</div>;
}
