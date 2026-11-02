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
  const plans = jobs.filter((j) => j.plan && j.plan.status !== "ended");
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
  const view = ["assets", "history", "details"].includes(requestedView ?? "")
    ? requestedView
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

  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p>
        <Link href="/app/customers">← Customers</Link>
      </p>
      <RememberCustomer id={customerId} name={c.displayName} />
      <h1>{c.displayName}</h1>
      {profileNotes
        .filter((n) => n.headsUp)
        .map((n) => (
          <p className="notice banner" role="note" key={n.id} data-heads-up>
            <span className="pill pill-warn">Heads-up</span> {n.body}
          </p>
        ))}
      {view === "overview" && !readOnly && (
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
            href={`${base}?add=note`}
            aria-current={adding === "note" ? "true" : undefined}
          >
            + Note
          </Link>
          <Link
            className="btn secondary"
            href={`${base}?add=attachment`}
            aria-current={adding === "attachment" ? "true" : undefined}
          >
            + Attachment
          </Link>
        </div>
      )}
      {view === "overview" && adding === "note" && !readOnly && (
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
                <input type="radio" name="kind" value="log" defaultChecked />
                History (what happened)
              </label>
              <label>
                <input type="radio" name="kind" value="profile" />
                Pin to profile (who they are)
              </label>
            </fieldset>
            <label htmlFor="new-note">Note</label>
            <textarea
              id="new-note"
              name="body"
              rows={3}
              required
              maxLength={5000}
              placeholder="Called and sent the invoice · or · Referred by Maria Lopez"
            />
            <label>
              <input type="checkbox" name="headsUp" />
              Heads-up (pinned notes only): show it on their jobs and visits
            </label>
          </ActionForm>
          <Link href={base}>Done</Link>
        </section>
      )}
      {view === "overview" && adding === "attachment" && !readOnly && (
        <section className="card add-panel" aria-label="Add an attachment">
          <h2>Add an attachment</h2>
          <p className="muted">
            License, insurance, tax-exempt certificate. Private to your shop.
          </p>
          <FileUploader
            customerId={customerId}
            categories={ATTACHMENT_CATEGORIES}
            buttonLabel="Choose file"
          />
          <Link href={base}>Done</Link>
        </section>
      )}
      <nav className="section-tabs" aria-label="Customer sections">
        {(
          [
            ["overview", "Profile"],
            ["assets", auto ? "Vehicles" : "Properties"],
            ["history", "History"],
            ["details", "Edit details"],
          ] as const
        ).map(([key, label]) => (
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
        <>
          <section className="card customer-bio" aria-label="Customer bio">
            <dl className="bio-list">
              <div>
                <dt>Address</dt>
                <dd>
                  {address || (
                    <Link href={`${base}?view=details`}>Add address</Link>
                  )}
                </dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>
                  {c.phoneE164 ? (
                    formatPhone(c.phoneE164)
                  ) : (
                    <Link href={`${base}?view=details`}>Add phone</Link>
                  )}
                  {c.textOptedOutAt && " (texts stopped)"}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>
                  {c.email ?? (
                    <Link href={`${base}?view=details`}>Add email</Link>
                  )}
                  {c.email && c.emailOptedOutAt && " (emails stopped)"}
                </dd>
              </div>
              <div>
                <dt>Customer since</dt>
                <dd>
                  {c.createdAt.toLocaleDateString("en-US", {
                    timeZone: tz,
                    month: "long",
                    year: "numeric",
                  })}
                </dd>
              </div>
            </dl>
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
              {address && (
                <a
                  className="btn secondary"
                  href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Map
                </a>
              )}
              <Link className="btn secondary" href={`${base}?view=details`}>
                Edit
              </Link>
            </div>
          </section>
          <section className="card" aria-label="Attachments" id="attachments">
            <h2>Attachments</h2>
            {!attachments.length && (
              <p className="muted">No attachments yet.</p>
            )}
            {attachments.map((d) => (
              <div className="overview-row" key={d.id}>
                <a href={`/media/${d.fileId}`} target="_blank" rel="noreferrer">
                  📎 {d.title}
                </a>
                <span className="muted">
                  {categoryLabel(d.category)} ·{" "}
                  {d.createdAt.toLocaleDateString("en-US", {
                    timeZone: tz,
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                {!readOnly && (
                  <ActionForm
                    action={removeDocumentAction}
                    hidden={{ documentId: d.id }}
                    submitLabel="Remove"
                    variant="danger"
                    confirm={`Remove ${d.title}?`}
                  />
                )}
              </div>
            ))}
          </section>
          <div className="overview-metrics">
            <div className="card overview-metric">
              <strong>{formatMoney(money.owedCents)}</strong>
              <span>Owes you</span>
            </div>
            <div className="card overview-metric">
              <strong>{formatMoney(money.paidCents)}</strong>
              <span>Paid you, all time</span>
            </div>
          </div>
          <section className="card" aria-label="Profile notes">
            <h2>About this customer</h2>
            {c.notes && <p style={{ whiteSpace: "pre-wrap" }}>{c.notes}</p>}
            {profileNotes.map((n) => (
              <div className="overview-row" key={n.id}>
                <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                  {n.headsUp && (
                    <>
                      <span className="pill pill-warn">Heads-up</span>{" "}
                    </>
                  )}
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
            {!c.notes && !profileNotes.length && (
              <p className="muted">
                Things to remember about them: who referred them, family members
                who are also customers, gate codes, how they like to be
                contacted.
              </p>
            )}
          </section>
          <section className="card" aria-label="Jobs" id="jobs">
            <h2>Jobs ({jobs.length})</h2>
            {jobs.length > 0 && (
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
                    href={`${base}?jobs=${f.key}#jobs`}
                    aria-current={filter.key === f.key ? "true" : undefined}
                  >
                    {f.label} (
                    {
                      jobs.filter((j) =>
                        (f.statuses as readonly string[]).includes(j.status),
                      ).length
                    }
                    )
                  </Link>
                ))}
              </div>
            )}
            {!jobs.length && (
              <p className="muted">No jobs yet. Tap New job to quote one.</p>
            )}
            {shownJobs.map((j) => (
              <Link
                className="overview-row customer-job"
                key={j.id}
                href={`/app/jobs?job=${j.id}`}
              >
                <span>
                  <strong>
                    {j.repeats && "↻ "}
                    {j.title}
                  </strong>
                  <span className="muted">
                    {" "}
                    ·{" "}
                    {j.createdAt.toLocaleDateString("en-US", {
                      timeZone: tz,
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </span>
                <span>
                  <span className={statusTone(j.status)}>
                    {statusLabels[j.status]}
                  </span>{" "}
                  {j.balanceCents > 0 ? (
                    <strong>owes {formatMoney(j.balanceCents)}</strong>
                  ) : (
                    j.amountCents !== null && (
                      <span className="muted">
                        {formatMoney(j.amountCents)}
                        {j.plan ? "/visit" : ""}
                      </span>
                    )
                  )}
                </span>
              </Link>
            ))}
          </section>
          {plans.length > 0 && (
            <section className="card" aria-label="Service plans">
              <h2>Service plans</h2>
              {plans.map((j) => (
                <Link
                  className="overview-row"
                  key={j.id}
                  href={`/app/jobs?job=${j.id}`}
                >
                  <span>
                    <strong>↻ {j.title}</strong>{" "}
                    <span className="muted">{cadenceText(j.plan!.repeat)}</span>
                  </span>
                  <span className="muted">
                    {j.plan!.status === "paused"
                      ? "Paused"
                      : j.plan!.next[0]
                        ? `Next: ${j.plan!.next[0].startsAt.toLocaleDateString(
                            "en-US",
                            {
                              timeZone: tz,
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            },
                          )}`
                        : "No visits scheduled"}
                  </span>
                </Link>
              ))}
            </section>
          )}
          <section className="card" aria-label="Recent history">
            <h2>Recent history</h2>
            {history.slice(0, 8).map((e) => (
              <HistoryRow key={e.id} item={e} timeZone={tz} />
            ))}
            {!history.length && <p className="muted">No history yet.</p>}
            {history.length > 8 && (
              <Link href={`${base}?view=history`}>See full history</Link>
            )}
          </section>
          <section className="card">
            <h2>{auto ? "Vehicles" : "Properties & equipment"}</h2>
            {!assetCount && (
              <p className="muted">
                {auto
                  ? "Add a vehicle before quoting repairs."
                  : "Add a property or equipment item before quoting work."}
              </p>
            )}
            <div className="record-shortcuts">
              {data.vehicles.map((v) => (
                <Link key={v.id} href={`${base}/vehicles/${v.id}`}>
                  {[v.year, v.make, v.model].filter(Boolean).join(" ") ||
                    "Vehicle"}
                </Link>
              ))}
              {assets.map((a) => (
                <Link key={a.id} href={`${base}?view=assets#asset-${a.id}`}>
                  {a.displayName}
                </Link>
              ))}
            </div>
          </section>
          {permissions}
        </>
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
      {view === "history" && (
        <Notes customerId={customerId} notes={historyNotes} />
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
              <h2>Vehicles</h2>
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>VIN</th>
                      <th>Plate</th>
                      <th>Mileage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vehicles.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <Link
                            href={`/app/customers/${customerId}/vehicles/${v.id}`}
                          >
                            <strong>
                              {[v.year, v.make, v.model, v.trim]
                                .filter(Boolean)
                                .join(" ") || "Vehicle"}
                            </strong>
                          </Link>
                        </td>
                        <td>{v.vin ?? "—"}</td>
                        <td>{v.plate ?? "—"}</td>
                        <td>
                          {v.mileage == null ? "—" : v.mileage.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {!data.vehicles.length && (
                      <tr>
                        <td colSpan={4} className="muted">
                          No vehicles yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="card" id="new-vehicle">
                <h2 style={{ marginTop: 0 }}>Add vehicle</h2>
                <ActionForm
                  action={createVehicleAction}
                  hidden={{ customerId }}
                  submitLabel="Add vehicle"
                >
                  <VehicleFields />
                </ActionForm>
              </div>
            </>
          )}
        </>
      )}
      {view === "history" && (
        <>
          <h2>History</h2>
          <div className="card">
            {history.length ? (
              history.map((e) => (
                <HistoryRow key={e.id} item={e} timeZone={tz} />
              ))
            ) : (
              <p className="muted">No history yet.</p>
            )}
          </div>
        </>
      )}
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
  return item.href ? (
    <Link className="overview-row" href={item.href}>
      {body}
    </Link>
  ) : (
    <div className="overview-row">{body}</div>
  );
}
