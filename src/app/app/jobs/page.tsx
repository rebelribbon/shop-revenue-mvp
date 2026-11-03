import { FileUploader } from "@/components/file-uploader";
import { JOB_FILE_CATEGORIES } from "@/domain/documents";
import { sendDocumentAction } from "@/server/actions/documents";
import { FileCabinet } from "@/components/file-cabinet";
import { jobCabinet, listTemplates } from "@/domain/documents";
import { openShareToken } from "@/lib/share-token";
import { customer as customerTable } from "@/db/schema";
import { z } from "zod";
import { MediaUploader } from "@/components/media-uploader";
import { MediaGallery } from "@/components/media-gallery";
import { listMedia } from "@/domain/job-media";
import { jobMedia as jobMediaTable } from "@/db/schema";
import { headsUpNotes, listNotes } from "@/domain/memory";
import { addNoteAction } from "@/server/actions/memory";
import { ActionForm } from "@/components/action-form";
import { cadenceText, untilText } from "@/lib/service-plans";
import { HydratedMain } from "@/components/hydrated-main";
import { listCommonJobs } from "@/domain/common-jobs";
import { loadJobWorkflows } from "@/domain/job-workflow";
import {
  JOB_FILTERS,
  JOB_STATUSES,
  jobFilter,
  jobStatus,
  jobStatusLabels,
  statusTone,
} from "@/lib/job-status";
import { JobWorkflow } from "@/components/job-workflow";
import {
  isAutomotive,
  recurringFirst,
  workspaceLabels,
} from "@/lib/business-types";
import { localDateKey } from "@/lib/timezone";
import { notFound } from "next/navigation";
import { WorkNavigation } from "@/components/work-navigation";
import { getBusinessProfile } from "@/domain/business-profile";
import { and, eq } from "drizzle-orm";
import { appointment, estimateVersion, recommendation } from "@/db/schema";
import { EstimatePublisher } from "@/components/estimate-publisher";
import Link from "next/link";
import { calculateJob } from "@/domain/job-costing";
import { jobInput } from "@/domain/jobs";
import { withTenant } from "@/db/tenant";
import { listAppointmentChoices } from "@/domain/appointments";
import { getJob, listJobs } from "@/domain/jobs";
import { JobEditor } from "@/components/job-editor";
import { requireShopSession } from "@/server/views/shop";
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    job?: string;
    new?: string;
    saved?: string;
    q?: string;
    stage?: string;
    show?: string;
    sort?: string;
    customerId?: string;
    vehicleId?: string;
    serviceAssetId?: string;
    sourceRecoveryItemId?: string;
    sourceContactActivityId?: string;
    sourceAppointmentId?: string;
    fromMedia?: string;
    add?: string;
    tab?: string;
  }>;
}) {
  const {
    edit,
    job,
    new: creating,
    saved,
    q,
    stage,
    show,
    sort,
    customerId,
    vehicleId,
    serviceAssetId,
    sourceRecoveryItemId,
    sourceContactActivityId,
    sourceAppointmentId,
    fromMedia,
    add,
    tab: requestedTab,
  } = await searchParams;
  const s = await requireShopSession("/app/jobs");
  const data = await withTenant(s.businessId, s.actor, async (tx) => {
    const page = {
      selected: edit || job ? await getJob(tx, (edit ?? job)!) : null,
      profile: await getBusinessProfile(tx),
      commonJobs: await listCommonJobs(tx),
      options: await listAppointmentChoices(tx),
      jobs: await listJobs(tx, q ?? ""),
      recommendations: await tx
        .select({
          id: recommendation.id,
          description: recommendation.description,
          vehicleId: recommendation.vehicleId,
          customerId: recommendation.customerId,
          serviceAssetId: estimateVersion.serviceAssetId,
        })
        .from(recommendation)
        .leftJoin(
          estimateVersion,
          and(
            eq(estimateVersion.businessId, recommendation.businessId),
            eq(estimateVersion.id, recommendation.sourceVersionId),
          ),
        )
        .where(eq(recommendation.businessId, tx.businessId))
        .limit(1000),
      sourceAppointment: sourceAppointmentId
        ? (
            await tx
              .select()
              .from(appointment)
              .where(
                and(
                  eq(appointment.businessId, tx.businessId),
                  eq(appointment.id, sourceAppointmentId),
                ),
              )
          )[0]
        : undefined,
    };
    const selectedCustomer = page.selected
      ? (page.selected.data as { customerId?: string }).customerId
      : undefined;
    return {
      ...page,
      cabinet: page.selected
        ? await jobCabinet(tx, page.selected.id, (c) => {
            try {
              return c ? openShareToken(c) : null;
            } catch {
              return null;
            }
          })
        : [],
      templates: page.selected ? await listTemplates(tx) : [],
      contact: selectedCustomer
        ? (
            await tx
              .select({
                phone: customerTable.phoneE164,
                email: customerTable.email,
                textOff: customerTable.textOptedOutAt,
                emailOff: customerTable.emailOptedOutAt,
              })
              .from(customerTable)
              .where(
                and(
                  eq(customerTable.businessId, tx.businessId),
                  eq(customerTable.id, selectedCustomer),
                ),
              )
          )[0]
        : undefined,
      jobMedia: page.selected
        ? await listMedia(tx, { jobId: page.selected.id })
        : [],
      fromMedia:
        fromMedia && z.uuid().safeParse(fromMedia).success
          ? (
              await tx
                .select()
                .from(jobMediaTable)
                .where(
                  and(
                    eq(jobMediaTable.businessId, tx.businessId),
                    eq(jobMediaTable.id, fromMedia),
                  ),
                )
            )[0]
          : undefined,
      jobNotes: selectedCustomer
        ? await listNotes(tx, selectedCustomer, undefined, {
            jobId: page.selected!.id,
          })
        : [],
      headsUp: selectedCustomer
        ? await headsUpNotes(tx, [selectedCustomer])
        : [],
      workflows: await loadJobWorkflows(tx, [
        ...new Set([
          ...page.jobs.map((j) => j.id),
          ...(page.selected ? [page.selected.id] : []),
        ]),
      ]),
    };
  });
  const type = data.profile?.businessType ?? "automotive",
    auto = isAutomotive(type),
    labels = workspaceLabels(type);
  const selected = data.selected;
  const flow = selected ? data.workflows.get(selected.id) : undefined;
  if ((edit || job) && !selected) notFound();
  const editing = !!(
    edit ||
    creating === "1" ||
    customerId ||
    sourceRecoveryItemId ||
    sourceAppointmentId
  );
  const statusLabels = jobStatusLabels(type);
  const statusOf = (id: string) => jobStatus(data.workflows.get(id)!);
  // ?stage=plan (older links) shows recurring jobs.
  const filter = jobFilter(
    show ?? (stage?.startsWith("plan") ? "recurring" : undefined),
  );
  const totalOf = (id: string) => {
    const f = data.workflows.get(id)!;
    return (
      f.currentInvoice?.totalCents ??
      f.latest?.estimate.snapshot.totalCents ??
      0
    );
  };
  const rows = data.jobs
    .filter((j) =>
      (filter.statuses as readonly string[]).includes(statusOf(j.id)),
    )
    .sort((a, b) =>
      sort === "oldest"
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : sort === "status"
          ? JOB_STATUSES.indexOf(statusOf(a.id)) -
            JOB_STATUSES.indexOf(statusOf(b.id))
          : sort === "amount"
            ? totalOf(b.id) - totalOf(a.id)
            : 0,
    );
  const chosenCustomer = data.options.customers.find(
    (c) => c.id === customerId,
  );
  const chosenVehicle = data.options.vehicles.find(
    (v) => v.id === vehicleId && v.customerId === customerId,
  );
  const chosenAsset = data.options.serviceAssets.find(
    (a) =>
      a.id === (serviceAssetId ?? data.sourceAppointment?.serviceAssetId) &&
      a.customerId === customerId,
  );
  const initial = selected
    ? {
        ...jobInput.parse(selected.data),
        jobId: selected.id,
        expectedVersion: selected.version,
      }
    : chosenCustomer
      ? {
          sourceRecoveryItemId:
            sourceRecoveryItemId ??
            data.sourceAppointment?.sourceRecoveryItemId ??
            undefined,
          sourceContactActivityId:
            sourceContactActivityId ??
            data.sourceAppointment?.sourceContactActivityId ??
            undefined,
          sourceAppointmentId,
          customerId: chosenCustomer.id,
          vehicleId: chosenVehicle?.id,
          serviceAssetId: chosenAsset?.id,
          title:
            data.fromMedia?.customerId === chosenCustomer.id
              ? (data.fromMedia.caption ?? "").slice(0, 200)
              : "",
          parts: [],
          labor: [],
        }
      : undefined;
  const money = (c: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(c / 100);
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>{editing ? (selected ? "Edit job" : labels.newJob) : labels.jobs}</h1>
      {!editing && !selected && (
        <WorkNavigation current="jobs" businessType={type} />
      )}
      {editing ? (
        <>
          <p>
            <Link
              href={selected ? `/app/jobs?job=${selected.id}` : "/app/jobs"}
            >
              ← Back to {selected ? "job" : "jobs"}
            </Link>
          </p>
          <JobEditor
            commonJobs={data.commonJobs}
            canSaveCommon={s.role === "owner" && s.actor.type !== "support"}
            laborSellRateCents={data.profile?.laborSellRateCents}
            laborCostRateCents={data.profile?.laborCostRateCents}
            partsTaxableDefault={data.profile?.partsTaxableDefault}
            laborTaxableDefault={data.profile?.laborTaxableDefault}
            businessType={data.profile?.businessType}
            key={
              selected?.version ??
              [
                customerId,
                vehicleId,
                serviceAssetId,
                sourceRecoveryItemId,
                sourceContactActivityId,
                sourceAppointmentId,
              ].join(":")
            }
            options={data.options}
            recommendations={data.recommendations}
            initial={initial}
            today={localDateKey(
              new Date(),
              data.profile?.timezone || "America/Chicago",
            )}
            defaultRepeats={recurringFirst(type)}
            attachMediaId={
              data.fromMedia && data.fromMedia.customerId === customerId
                ? data.fromMedia.id
                : undefined
            }
          />
        </>
      ) : selected ? (
        (() => {
          const input = jobInput.parse(selected.data),
            t = calculateJob(input.parts, input.labor),
            customerName =
              data.options.customers.find((c) => c.id === input.customerId)
                ?.name ?? "Customer",
            tab = ["photos", "files", "notes", "timeline"].includes(
              requestedTab ?? "",
            )
              ? requestedTab!
              : "work";
          return (
            <>
              <p>
                <Link href={`/app/customers/${input.customerId}`}>
                  ← {customerName}
                </Link>
              </p>
              {saved === "1" && (
                <p role="status" className="notice ok">
                  Job saved.
                </p>
              )}
              <article className="card job-profile">
                <header className="profile-head">
                  <div>
                    <h2 className="profile-title">
                      {input.repeat && "↻ "}
                      {selected.title}
                    </h2>
                    <p className="muted">
                      {[
                        flow?.latest?.estimate.snapshot.serviceLabel ||
                          flow?.latest?.estimate.snapshot.vehicleLabel,
                        input.repeat &&
                          `${cadenceText(input.repeat)}, ${untilText(input.repeat)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || customerName}
                    </p>
                  </div>
                  {flow && (
                    <span className={statusTone(statusOf(selected.id))}>
                      {statusLabels[statusOf(selected.id)]}
                    </span>
                  )}
                </header>
                {data.headsUp.map((n, i) => (
                  <p
                    className="heads-up-line"
                    role="note"
                    key={i}
                    data-heads-up
                  >
                    ⚠ {n.body}
                  </p>
                ))}
                {flow && (
                  <p className="stat-strip" aria-label="Job money">
                    <span>
                      <strong>
                        {money(
                          flow.latest?.estimate.snapshot.totalCents ??
                            t.subtotalCents,
                        )}
                      </strong>{" "}
                      {input.repeat ? "per visit" : "quoted"}
                    </span>
                    <span>
                      <strong>
                        {money(
                          flow.plan ? flow.plan.billedCents : flow.paidCents,
                        )}
                      </strong>{" "}
                      {flow.plan ? "billed so far" : "paid"}
                    </span>
                    {flow.balanceCents > 0 && (
                      <span>
                        <strong>{money(flow.balanceCents)}</strong> owed
                      </span>
                    )}
                  </p>
                )}
                {s.actor.type !== "support" && (
                  <div className="action-bar" role="group" aria-label="Add">
                    {(
                      [
                        ["note", "+ Note"],
                        ["photo", "+ Photo / video"],
                        ["file", "+ File"],
                        ["sign", "✍ Send to sign"],
                      ] as const
                    ).map(([key, label]) => (
                      <Link
                        key={key}
                        className="btn secondary"
                        href={`/app/jobs?job=${selected.id}&add=${key}`}
                        aria-current={add === key ? "true" : undefined}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                )}
                {s.actor.type !== "support" && add === "note" && (
                  <section className="card add-panel" aria-label="Add a note">
                    <h3>Note about this job</h3>
                    <ActionForm
                      action={addNoteAction}
                      hidden={{
                        customerId: input.customerId,
                        jobId: selected.id,
                        kind: "log",
                      }}
                      submitLabel="Save note"
                      variant="primary"
                    >
                      <label htmlFor="job-note">Note</label>
                      <textarea
                        id="job-note"
                        name="body"
                        rows={3}
                        required
                        maxLength={5000}
                        placeholder="Gate code 4412 · found a cracked rotor"
                      />
                    </ActionForm>
                    <Link href={`/app/jobs?job=${selected.id}`}>Done</Link>
                  </section>
                )}
                {s.actor.type !== "support" && add === "photo" && (
                  <section className="card add-panel" aria-label="Add photos">
                    <h3>Add photos or video</h3>
                    <MediaUploader
                      customerId={input.customerId}
                      jobId={selected.id}
                      vehicleId={input.vehicleId ?? null}
                      serviceAssetId={input.serviceAssetId ?? null}
                      defaultTag={flow?.currentInvoice ? "after" : "before"}
                    />
                    <Link href={`/app/jobs?job=${selected.id}&tab=photos`}>
                      Done
                    </Link>
                  </section>
                )}
                {s.actor.type !== "support" && add === "file" && (
                  <section className="card add-panel" aria-label="Add a file">
                    <h3>Add a file to this job</h3>
                    <FileUploader
                      customerId={input.customerId}
                      jobId={selected.id}
                      categories={JOB_FILE_CATEGORIES}
                      buttonLabel="Choose file"
                    />
                    <Link href={`/app/jobs?job=${selected.id}&tab=files`}>
                      Done
                    </Link>
                  </section>
                )}
                {s.actor.type !== "support" && add === "sign" && (
                  <section
                    className="card add-panel"
                    aria-label="Send a document to sign"
                  >
                    <h3>Send a document to sign</h3>
                    {data.templates.length ? (
                      <ActionForm
                        action={sendDocumentAction}
                        hidden={{ jobId: selected.id }}
                        submitLabel="Send for signature"
                        variant="primary"
                      >
                        <label htmlFor="send-template">Document</label>
                        <select id="send-template" name="templateId" required>
                          {data.templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </ActionForm>
                    ) : (
                      <p className="muted">
                        No documents yet.{" "}
                        {s.role === "owner" ? (
                          <Link href="/app/settings/documents">
                            Set up your documents
                          </Link>
                        ) : (
                          "Ask the owner to add them in Settings."
                        )}
                      </p>
                    )}
                    <p className="muted">
                      The signing link appears in the file cabinet below, ready
                      to text or email.
                    </p>
                    <Link href={`/app/jobs?job=${selected.id}&tab=files`}>
                      Done
                    </Link>
                  </section>
                )}
                <nav className="section-tabs" aria-label="Job sections">
                  {(
                    [
                      ["work", "Work"],
                      [
                        "photos",
                        `Photos${data.jobMedia.length ? ` (${data.jobMedia.length})` : ""}`,
                      ],
                      [
                        "files",
                        `Files${data.cabinet.length ? ` (${data.cabinet.length})` : ""}`,
                      ],
                      [
                        "notes",
                        `Notes${data.jobNotes.length ? ` (${data.jobNotes.length})` : ""}`,
                      ],
                      ["timeline", "Timeline"],
                    ] as const
                  ).map(([key, label]) => (
                    <Link
                      key={key}
                      href={`/app/jobs?job=${selected.id}${key === "work" ? "" : `&tab=${key}`}`}
                      aria-current={tab === key ? "page" : undefined}
                    >
                      {label}
                    </Link>
                  ))}
                </nav>
                {tab === "work" && (
                  <>
                    {flow && (
                      <JobWorkflow
                        flow={flow}
                        jobId={selected.id}
                        timezone={data.profile?.timezone || "America/Chicago"}
                        readOnly={s.actor.type === "support"}
                      />
                    )}
                  </>
                )}
                {tab === "photos" && (
                  <>
                    <section aria-label="Photos and videos" id="job-photos">
                      <h3>Photos &amp; videos</h3>
                      <p className="muted">
                        Photos switched to “Show the customer” appear on the
                        next estimate you send, and on the invoice.
                      </p>
                      <MediaGallery
                        quoteHref={(m) =>
                          `/app/jobs?${new URLSearchParams({
                            customerId: input.customerId,
                            ...(input.vehicleId
                              ? { vehicleId: input.vehicleId }
                              : {}),
                            ...(input.serviceAssetId
                              ? { serviceAssetId: input.serviceAssetId }
                              : {}),
                            fromMedia: m.id,
                          })}`
                        }
                        items={data.jobMedia}
                        readOnly={s.actor.type === "support"}
                        timeZone={data.profile?.timezone || "America/Chicago"}
                      />
                    </section>
                  </>
                )}
                {tab === "files" && (
                  <>
                    <FileCabinet
                      items={data.cabinet}
                      customerPhone={
                        data.contact && !data.contact.textOff
                          ? data.contact.phone
                          : null
                      }
                      customerEmail={
                        data.contact && !data.contact.emailOff
                          ? data.contact.email
                          : null
                      }
                      readOnly={s.actor.type === "support"}
                      timeZone={data.profile?.timezone || "America/Chicago"}
                    />
                  </>
                )}
                {tab === "notes" && (
                  <>
                    <section aria-label="Job notes">
                      <h3>Notes</h3>
                      {data.jobNotes.map((n) => (
                        <p
                          key={n.id}
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          📝 {n.body}{" "}
                          <span className="muted">
                            ·{" "}
                            {n.createdAt.toLocaleDateString("en-US", {
                              timeZone:
                                data.profile?.timezone || "America/Chicago",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </p>
                      ))}
                      {!data.jobNotes.length && (
                        <p className="muted">
                          Gate codes, what you found, what the customer asked
                          for.
                        </p>
                      )}
                    </section>
                  </>
                )}
                {tab === "work" && (
                  <>
                    <section aria-label="Job costs">
                      <h3>Costs &amp; profit</h3>
                      <div className="money-actions">
                        <Link href={`/app/jobs?edit=${selected.id}`}>
                          Edit job / actual hours
                        </Link>
                        <Link href={`/app/estimates?jobId=${selected.id}`}>
                          Estimate history
                        </Link>
                      </div>
                      <p>
                        Quoted: {money(t.subtotalCents)} · Estimated job profit:{" "}
                        {t.estimatedGrossProfitCents === null
                          ? "unknown until every cost is entered"
                          : money(t.estimatedGrossProfitCents)}
                      </p>
                    </section>
                    <section aria-label="Line items">
                      <h3>{auto ? "Parts" : "Materials"} &amp; labor</h3>
                      <ul>
                        {input.parts.map((part, i) => (
                          <li key={i}>
                            {part.description} — {part.quantity} ×{" "}
                            {money(part.unitPriceCents)} (unit cost{" "}
                            {part.unitCostCents === null
                              ? "not entered"
                              : money(part.unitCostCents)}
                            )
                          </li>
                        ))}
                        {input.labor.map((line, i) => (
                          <li key={i}>
                            {line.description} —{" "}
                            {line.estimatedHoursHundredths / 100} quoted hours;{" "}
                            {line.actualHoursHundredths === null
                              ? "actual time unknown"
                              : `${line.actualHoursHundredths / 100} actual hours`}
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section className="record-details" id="job-estimate">
                      <h3>Customer estimate</h3>
                      {!flow?.currentInvoice && s.actor.type !== "support" ? (
                        <EstimatePublisher
                          taxRateBps={data.profile?.taxRateBps}
                          jobId={selected.id}
                          version={selected.version}
                          existingVersion={flow?.latest?.estimate.version}
                          pendingChanges={flow?.changedSinceEstimate}
                        />
                      ) : (
                        <p>
                          Issued invoice and authorization stay linked to this
                          job. Use a separate job for additional billable work.
                        </p>
                      )}
                    </section>
                  </>
                )}
                {tab === "timeline" && flow && (
                  <ol className="workflow-timeline">
                    {flow.timeline.map((e) => (
                      <li key={e.id}>
                        <strong>{e.text}</strong>{" "}
                        <span className="muted">
                          {e.at.toLocaleString("en-US", {
                            timeZone:
                              data.profile?.timezone || "America/Chicago",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            </>
          );
        })()
      ) : (
        <>
          <Link
            className="btn primary"
            data-page-primary
            data-stable-primary
            href="/app/jobs?new=1"
          >
            {labels.newJob}
          </Link>
          <form className="inline-search job-search" method="get" role="search">
            <input type="hidden" name="show" value={filter.key} />
            <div className="job-search-fields">
              <div>
                <label htmlFor="job-search">Find a job</label>
                <div className="search-controls">
                  <input
                    id="job-search"
                    name="q"
                    type="search"
                    defaultValue={q ?? ""}
                    maxLength={100}
                    placeholder="Job or customer name"
                  />
                  <button className="btn secondary">Search</button>
                </div>
              </div>
              <div>
                <label htmlFor="job-sort">Sort</label>
                <select
                  id="job-sort"
                  name="sort"
                  defaultValue={sort ?? "newest"}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="status">By status</option>
                  <option value="amount">Biggest first</option>
                </select>
              </div>
            </div>
          </form>
          <div className="chip-links" role="group" aria-label="Show jobs">
            {JOB_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/app/jobs?${new URLSearchParams({ show: f.key, ...(q ? { q } : {}), ...(sort ? { sort } : {}) })}`}
                aria-current={filter.key === f.key ? "true" : undefined}
              >
                {f.label} (
                {
                  data.jobs.filter((j) =>
                    (f.statuses as readonly string[]).includes(statusOf(j.id)),
                  ).length
                }
                )
              </Link>
            ))}
          </div>
          {!rows.length ? (
            <div className="empty-records">
              <h2>
                {q
                  ? "No matching jobs"
                  : auto
                    ? "No repair jobs yet"
                    : "No jobs yet"}
              </h2>
              <p className="muted">
                {q
                  ? "Try another name. Only the 100 most recent matches show here."
                  : "Start a new job from a customer, add the work, then send the estimate."}
              </p>
            </div>
          ) : (
            <ul className="row-list card" aria-label="Jobs">
              {rows.map((j) => {
                const input = jobInput.parse(j.data),
                  t = calculateJob(input.parts, input.labor),
                  flow = data.workflows.get(j.id),
                  owes =
                    flow?.currentInvoice && flow.balanceCents > 0
                      ? flow.balanceCents
                      : 0,
                  customer = data.options.customers.find(
                    (c) => c.id === input.customerId,
                  )?.name;
                return (
                  <li key={j.id}>
                    <Link
                      href={`/app/jobs?job=${j.id}`}
                      aria-label={`Open job: ${j.title} · ${statusLabels[statusOf(j.id)]}`}
                    >
                      <span className="row-main">
                        <strong>
                          {input.repeat && "↻ "}
                          {j.title}
                        </strong>
                        <span className="muted">
                          {[
                            customer,
                            j.createdAt.toLocaleDateString("en-US", {
                              timeZone:
                                data.profile?.timezone || "America/Chicago",
                              month: "short",
                              day: "numeric",
                            }),
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </span>
                      <span className="row-side">
                        {owes > 0 ? (
                          <strong>owes {money(owes)}</strong>
                        ) : (
                          <span>{money(t.subtotalCents)}</span>
                        )}
                        <span className={statusTone(statusOf(j.id))}>
                          {statusLabels[statusOf(j.id)]}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </HydratedMain>
  );
}
