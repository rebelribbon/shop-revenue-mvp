import { RecordSection, WorkCard } from "@/components/record-section";
import { CustomerContactSummary } from "@/components/customer-contact-summary";
import { CustomerContactActions } from "@/components/customer-contact-actions";
import { groupWork } from "@/lib/work-sections";
import { formatPhone } from "@/lib/phone-format";
import { jobReference } from "@/lib/job-reference";
import { HydratedMain } from "@/components/hydrated-main";
import { ServiceAssets } from "@/components/service-assets";
import { listServiceAssets } from "@/domain/service-assets";
import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive } from "@/lib/business-types";
import { Notes } from "@/components/memory";
import { RememberCustomer } from "@/components/recent-customers";
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
import { portalLink } from "@/domain/customer-portal";
import { createPortalLinkAction } from "@/server/actions/customer-portal";
import { askForReviewAction } from "@/server/actions/review-requests";
import { setLeadSourceAction } from "@/server/actions/customers";
import { LEAD_SOURCES, leadSourceLabel } from "@/lib/lead-sources";
import {
  lastReviewRequest,
  readReviewSettings,
} from "@/domain/review-requests";
import { CopyLink } from "@/components/copy-link";
import { ContactPermissions } from "@/components/contact-permissions";

export default async function CustomerDetailPage(props: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ view?: string; jobs?: string; add?: string }>;
}) {
  const { customerId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}`);
  const [
    data,
    history,
    notes,
    profile,
    assets,
    jobs,
    money,
    portal,
    reviewLink,
    lastReview,
  ] = await withTenant(s.businessId, s.actor, async (tx) =>
    Promise.all([
      getCustomerWithVehicles(tx, customerId),
      customerHistory(tx, customerId),
      listNotes(tx, customerId),
      getBusinessProfile(tx),
      listServiceAssets(tx, customerId),
      listCustomerJobs(tx, customerId),
      customerMoney(tx, customerId),
      portalLink(tx, customerId),
      readReviewSettings(tx).then((r) => r.link),
      lastReviewRequest(tx, customerId),
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
  const view = ["overview", "jobs", "assets", "history", "details"].includes(
    requestedView ?? "",
  )
    ? requestedView!
    : "overview";
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
  const activeJobs = jobs.filter(
    (j) => !["paid", "lost", "ended"].includes(j.status),
  );

  const when = (d: Date) =>
    d.toLocaleDateString("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const tabs = [
    ["overview", "Overview"],
    [
      "jobs",
      `${auto ? "ROs" : "Jobs"}${jobs.length ? ` (${jobs.length})` : ""}`,
    ],
    ["history", "History"],
    ["assets", auto ? "Vehicles" : "Properties"],
    ["details", "Details"],
  ] as const;

  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <RememberCustomer id={customerId} name={c.displayName} />
      <p>
        <Link href="/app/customers">← Customers</Link>
      </p>
      <header className="customer-hero" aria-label="Customer summary">
        <CustomerContactActions
          phone={c.phoneE164}
          email={c.email}
          textAllowed={!c.textOptedOutAt && !c.doNotContact}
          emailAllowed={!c.emailOptedOutAt && !c.doNotContact}
        />
        <div className="customer-hero-main">
          <div className="customer-hero-avatar" aria-hidden="true">
            {c.displayName.trim().charAt(0).toUpperCase()}
          </div>
          <div className="customer-hero-identity">
            <p className="customer-eyebrow">Customer record</p>
            <h1>{c.displayName}</h1>
            <CustomerContactSummary
              phone={c.phoneE164 ? formatPhone(c.phoneE164) : null}
              email={c.email}
              address={address}
              addressHref={
                address
                  ? `https://maps.google.com/?q=${encodeURIComponent(address)}`
                  : undefined
              }
            />
            <p className="muted customer-hero-asset">
              {auto
                ? data.vehicles[0]
                  ? [
                      data.vehicles[0].year,
                      data.vehicles[0].make,
                      data.vehicles[0].model,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : "No vehicle on file"
                : assets.length
                  ? `${assets.length} service asset${assets.length === 1 ? "" : "s"}`
                  : "No property or equipment on file"}
            </p>
          </div>
        </div>
        <div
          className="customer-hero-actions"
          role="group"
          aria-label="Customer work actions"
        >
          {!readOnly && (
            <Link
              className="btn primary"
              data-page-primary
              href={
                assetCount
                  ? `/app/jobs?customerId=${customerId}`
                  : `${base}?view=assets`
              }
            >
              {auto ? "+ New RO" : "+ New job"}
            </Link>
          )}
          {!readOnly && (
            <Link
              className="btn secondary"
              href={`/app/schedule?new=1&customerId=${customerId}`}
            >
              + Appointment
            </Link>
          )}
        </div>
      </header>
      <div className="profile-layout customer-profile-layout">
        <aside className="card profile-card customer-profile-side">
          <header className="profile-head">
            <div>
              <h2 className="profile-title">Account summary</h2>
              <p className="muted">
                Customer since{" "}
                {c.createdAt.toLocaleDateString("en-US", {
                  timeZone: tz,
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
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
          <details className="record-customer-tools">
            <summary>Customer options</summary>
            <div className="portal-box">
              <h2>Customer link</h2>
              <p className="muted">
                One link for their estimates, invoices, papers to sign and
                visits.
              </p>
              {portal ? (
                <CopyLink
                  path={portal}
                  label="Copy customer link"
                  intro="Here’s your account: estimates, invoices and visits in one place."
                  title={`Your account with ${profile?.dba || profile?.legalName || "us"}`}
                  phone={c.textOptedOutAt ? null : c.phoneE164}
                  email={c.emailOptedOutAt ? null : c.email}
                />
              ) : (
                !readOnly && (
                  <ActionForm
                    action={createPortalLinkAction}
                    hidden={{ customerId }}
                    submitLabel="Create customer link"
                    variant="secondary"
                  />
                )
              )}
            </div>
            <div className="portal-box">
              <h2>Found us</h2>
              {readOnly ? (
                <p>
                  {leadSourceLabel(c.leadSource)}
                  {c.leadSourceDetail && ` · ${c.leadSourceDetail}`}
                </p>
              ) : (
                <ActionForm
                  action={setLeadSourceAction}
                  hidden={{ customerId }}
                  submitLabel="Save"
                  variant="secondary"
                >
                  <label htmlFor="lead-source">How did they find you?</label>
                  <select
                    id="lead-source"
                    name="leadSource"
                    defaultValue={c.leadSource ?? ""}
                  >
                    <option value="">Not set</option>
                    {LEAD_SOURCES.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="lead-detail">
                    Details <span className="muted">(who referred them)</span>
                  </label>
                  <input
                    id="lead-detail"
                    name="leadSourceDetail"
                    maxLength={200}
                    defaultValue={c.leadSourceDetail ?? ""}
                  />
                </ActionForm>
              )}
            </div>
            {reviewLink && (
              <div className="portal-box">
                <h2>Review</h2>
                <p className="muted">
                  {lastReview
                    ? `${lastReview.status === "sent" ? "Asked" : "Tried to ask"} ${lastReview.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
                    : "Not asked yet."}
                </p>
                {!readOnly && c.email && !c.emailOptedOutAt && (
                  <ActionForm
                    action={askForReviewAction}
                    hidden={{ customerId }}
                    submitLabel="★ Ask for a review"
                    variant="secondary"
                  />
                )}
              </div>
            )}
          </details>
        </aside>
        <div className="profile-main customer-profile-main">
          {!readOnly && (
            <div className="action-bar" role="group" aria-label="Add">
              <Link
                className="btn secondary"
                href={`${base}?view=${view}&add=note`}
                aria-current={adding === "note" ? "true" : undefined}
              >
                + Note
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
          <nav
            className="section-tabs customer-record-tabs"
            aria-label="Customer sections"
          >
            {tabs.map(([key, label]) => (
              <Link
                key={key}
                href={`${base}?view=${key}`}
                aria-current={view === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          {view === "overview" && (
            <section
              className="customer-overview"
              aria-label="Customer overview"
            >
              <div className="customer-overview-grid">
                <article className="card customer-overview-card customer-work-overview">
                  <div className="section-heading">
                    <h2>{auto ? "Active ROs" : "Active jobs"}</h2>
                    <Link href={`${base}?view=jobs`}>
                      {auto ? "All ROs" : "All jobs"}
                    </Link>
                  </div>
                  <div className="record-work-grid">
                    {activeJobs.slice(0, 3).map((j) => (
                      <WorkCard
                        key={j.id}
                        href={`/app/jobs?job=${j.id}`}
                        reference={jobReference(j.id, auto)}
                        title={j.title}
                        status={statusLabels[j.status]}
                        statusClass={statusTone(j.status)}
                        amount={
                          j.balanceCents > 0
                            ? formatMoney(j.balanceCents)
                            : j.amountCents !== null
                              ? formatMoney(j.amountCents)
                              : undefined
                        }
                        amountLabel={
                          j.balanceCents > 0 ? "Balance due" : "Estimate"
                        }
                      />
                    ))}
                  </div>
                  {!activeJobs.length && (
                    <p className="muted">
                      No active work. Start a new job or open the work history.
                    </p>
                  )}
                </article>
                <article className="card customer-overview-card">
                  <div className="section-heading">
                    <h2>Recent activity</h2>
                    <Link href={`${base}?view=history`}>History</Link>
                  </div>
                  {history.slice(0, 3).map((e) => (
                    <div className="customer-activity-row" key={e.id}>
                      <span>{e.summary}</span>
                      <small className="muted">{when(e.at)}</small>
                    </div>
                  ))}
                  {!history.length && (
                    <p className="muted">No activity recorded yet.</p>
                  )}
                </article>
                <article className="card customer-overview-card">
                  <div className="section-heading">
                    <h2>{auto ? "Vehicles" : "Properties & equipment"}</h2>
                    <Link href={`${base}?view=assets`}>View all</Link>
                  </div>
                  <p>{assetCount} on file</p>
                  <Link className="btn secondary" href={`${base}?view=assets`}>
                    {auto ? "View vehicles" : "View assets"}
                  </Link>
                </article>
              </div>
            </section>
          )}
          {view === "jobs" && (
            <section
              aria-label={auto ? "Repair orders" : "Jobs"}
              id="jobs"
              className="customer-job-history"
            >
              <div className="section-heading">
                <h2>{auto ? "Repair order history" : "Job history"}</h2>
                {!readOnly && (
                  <Link
                    className="btn primary"
                    href={
                      assetCount
                        ? `/app/jobs?customerId=${customerId}`
                        : `${base}?view=assets`
                    }
                  >
                    {auto ? "+ New RO" : "+ New job"}
                  </Link>
                )}
              </div>
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
                      href={`${base}?view=jobs&jobs=${f.key}`}
                      aria-current={filter.key === f.key ? "true" : undefined}
                    >
                      {f.label}
                    </Link>
                  ))}
                </div>
              )}
              {!jobs.length && (
                <p className="muted">
                  No previous jobs. Start a new one from this customer.
                </p>
              )}
              {groupWork(shownJobs, (j) => j.status)
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <RecordSection
                    key={group.key}
                    title={group.title}
                    description={group.description}
                    count={group.items.length}
                    className={`record-section-${group.key}`}
                  >
                    <ul className="record-work-grid">
                      {group.items.map((j) => (
                        <li key={j.id}>
                          <WorkCard
                            href={`/app/jobs?job=${j.id}`}
                            reference={jobReference(j.id, auto)}
                            title={`${j.repeats ? "↻ " : ""}${j.title}`}
                            detail={
                              j.plan && j.plan.status !== "ended"
                                ? cadenceText(j.plan.repeat)
                                : when(j.createdAt)
                            }
                            status={statusLabels[j.status]}
                            statusClass={statusTone(j.status)}
                            amount={
                              j.balanceCents > 0
                                ? formatMoney(j.balanceCents)
                                : j.amountCents !== null
                                  ? formatMoney(j.amountCents)
                                  : undefined
                            }
                            amountLabel={
                              j.balanceCents > 0 ? "Balance due" : "Estimate"
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </RecordSection>
                ))}
            </section>
          )}
          {view === "history" && (
            <RecordSection
              title="Customer history"
              description="Calls, appointments and previous work in date order."
            >
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
            </RecordSection>
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
