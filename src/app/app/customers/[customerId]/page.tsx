import { formatPhone } from "@/lib/phone-format";
import { HydratedMain } from "@/components/hydrated-main";
import { ServiceAssets } from "@/components/service-assets";
import { listServiceAssets } from "@/domain/service-assets";
import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive } from "@/lib/business-types";
import { Notes } from "@/components/memory";
import { RememberCustomer } from "@/components/recent-customers";
import { MediaUploader } from "@/components/media-uploader";
import { MediaGallery } from "@/components/media-gallery";
import { listMedia } from "@/domain/job-media";
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
  searchParams: Promise<{ view?: string; jobs?: string }>;
}) {
  const { customerId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}`);
  const [data, history, notes, profile, assets, jobs, money, media] =
    await withTenant(s.businessId, s.actor, async (tx) =>
      Promise.all([
        getCustomerWithVehicles(tx, customerId),
        customerHistory(tx, customerId),
        listNotes(tx, customerId),
        getBusinessProfile(tx),
        listServiceAssets(tx, customerId),
        listCustomerJobs(tx, customerId),
        customerMoney(tx, customerId),
        listMedia(tx, { customerId }),
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
  const readOnly = s.actor.type === "support";
  const c = data.customer;
  const { view: requestedView } = await props.searchParams;
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
      <p className="muted">
        Customer since{" "}
        {c.createdAt.toLocaleDateString("en-US", {
          timeZone: tz,
          month: "short",
          year: "numeric",
        })}
        {assets[0]?.details &&
        (assets[0].details as { addressLine1?: string }).addressLine1
          ? ` · ${(assets[0].details as { addressLine1?: string }).addressLine1}`
          : ""}
      </p>
      {profileNotes
        .filter((n) => n.headsUp)
        .map((n) => (
          <p className="notice banner" role="note" key={n.id} data-heads-up>
            <span className="pill pill-warn">Heads-up</span> {n.body}
          </p>
        ))}
      {view === "overview" && (
        <Link
          className="btn primary"
          data-page-primary
          href={
            assetCount
              ? `/app/jobs?customerId=${customerId}`
              : `${base}?view=assets`
          }
        >
          {assetCount
            ? "New job"
            : auto
              ? "Add vehicle"
              : "Add property / equipment"}
        </Link>
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
          <div className="money-actions" aria-label="Contact">
            {c.phoneE164 && (
              <a className="btn secondary" href={`tel:${c.phoneE164}`}>
                Call {formatPhone(c.phoneE164)}
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
            {!c.phoneE164 && !c.email && (
              <Link href={`${base}?view=details`}>Add a phone or email</Link>
            )}
          </div>
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
            {!readOnly && (
              <details>
                <summary>Add a profile note</summary>
                <ActionForm
                  action={addNoteAction}
                  hidden={{ customerId, kind: "profile" }}
                  submitLabel="Save profile note"
                >
                  <label htmlFor="profile-note">Note</label>
                  <textarea
                    id="profile-note"
                    name="body"
                    rows={3}
                    required
                    maxLength={5000}
                    placeholder="Referred by Maria Lopez · Spouse: Dan (also a customer)"
                  />
                  <label>
                    <input type="checkbox" name="headsUp" />
                    Heads-up: show this on their jobs and visits too
                  </label>
                </ActionForm>
              </details>
            )}
          </section>
          <section className="card" aria-label="Jobs" id="jobs">
            <h2>Jobs ({jobs.length})</h2>
            {jobs.length > 0 && (
              <nav className="chip-links" aria-label="Show jobs">
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
              </nav>
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
          <section className="card" aria-label="Photos and videos" id="photos">
            <h2>Photos &amp; videos</h2>
            {!readOnly && (
              <MediaUploader
                customerId={customerId}
                defaultTag="issue"
                vehicleId={
                  data.vehicles.length === 1 ? data.vehicles[0].id : null
                }
                serviceAssetId={assets.length === 1 ? assets[0].id : null}
              />
            )}
            <MediaGallery
              items={media.slice(0, 24)}
              readOnly={readOnly}
              timeZone={tz}
              quoteHref={(m) =>
                `/app/jobs?${new URLSearchParams({
                  customerId,
                  ...(m.vehicleId ? { vehicleId: m.vehicleId } : {}),
                  ...(m.serviceAssetId
                    ? { serviceAssetId: m.serviceAssetId }
                    : {}),
                  fromMedia: m.id,
                })}`
              }
            />
          </section>
          <section className="card" aria-label="Recent history">
            <h2>Recent history</h2>
            {!readOnly && (
              <ActionForm
                action={addNoteAction}
                hidden={{ customerId, kind: "log" }}
                submitLabel="Add to history"
                variant="secondary"
              >
                <label htmlFor="history-note">What happened?</label>
                <input
                  id="history-note"
                  name="body"
                  required
                  maxLength={5000}
                  placeholder="Called and sent the invoice"
                />
              </ActionForm>
            )}
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
          <details className="card">
            <summary>Contact details &amp; text/email preferences</summary>
            <p>
              {c.phoneE164 ? formatPhone(c.phoneE164) : "No phone recorded"} ·{" "}
              {c.email
                ? `${c.email}${c.emailOptedOutAt ? " (emails stopped)" : ""}`
                : "No email recorded"}
            </p>
            <Link href={`${base}?view=details`}>Edit contact details</Link>
            {permissions}
          </details>
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
