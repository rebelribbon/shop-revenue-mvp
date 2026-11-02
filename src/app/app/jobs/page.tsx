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
import { JobWorkflow, WorkflowBadges } from "@/components/job-workflow";
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
import { WorkspaceIcon } from "@/components/workspace-icon";
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
      <WorkNavigation current="jobs" businessType={type} />
      <p className="muted">
        {editing
          ? "Add the work and save. Send the estimate next."
          : selected
            ? ""
            : "Open a job to review pricing, labor hours and costs."}
      </p>
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
            t = calculateJob(input.parts, input.labor);
          return (
            <>
              <p>
                <Link href={`/app/customers/${input.customerId}`}>
                  ←{" "}
                  {data.options.customers.find((c) => c.id === input.customerId)
                    ?.name ?? "Customer"}
                </Link>
              </p>
              {data.headsUp.map((n, i) => (
                <p className="notice banner" role="note" key={i} data-heads-up>
                  <span className="pill pill-warn">Heads-up</span> {n.body}
                </p>
              ))}
              {saved === "1" && (
                <p role="status" className="notice ok">
                  Job saved.
                </p>
              )}
              <article className="card">
                <h2>
                  {input.repeat && "↻ "}
                  {selected.title}
                </h2>
                <p>
                  <Link href={`/app/customers/${input.customerId}`}>
                    {
                      data.options.customers.find(
                        (c) => c.id === input.customerId,
                      )?.name
                    }
                  </Link>
                  {flow?.latest?.estimate.snapshot.serviceLabel ||
                  flow?.latest?.estimate.snapshot.vehicleLabel
                    ? ` · ${flow.latest.estimate.snapshot.serviceLabel || flow.latest.estimate.snapshot.vehicleLabel}`
                    : ""}
                </p>
                {input.repeat && (
                  <p className="muted">
                    {cadenceText(input.repeat)} · {untilText(input.repeat)}
                  </p>
                )}
                {flow && (
                  <div className="overview-metrics" aria-label="Job money">
                    <div className="card overview-metric">
                      <strong>
                        {money(
                          flow.latest?.estimate.snapshot.totalCents ??
                            t.subtotalCents,
                        )}
                      </strong>
                      <span>{input.repeat ? "Per visit" : "Quoted"}</span>
                    </div>
                    <div className="card overview-metric">
                      <strong>
                        {money(
                          flow.plan ? flow.plan.billedCents : flow.paidCents,
                        )}
                      </strong>
                      <span>{flow.plan ? "Billed so far" : "Paid"}</span>
                    </div>
                    {flow.balanceCents > 0 && (
                      <div className="card overview-metric">
                        <strong>{money(flow.balanceCents)}</strong>
                        <span>Still owed</span>
                      </div>
                    )}
                  </div>
                )}
                {flow && (
                  <JobWorkflow
                    flow={flow}
                    jobId={selected.id}
                    timezone={data.profile?.timezone || "America/Chicago"}
                    readOnly={s.actor.type === "support"}
                  />
                )}
                <section aria-label="Photos and videos" id="job-photos">
                  <h3>Photos &amp; videos</h3>
                  <p className="muted">
                    Photos switched to “Show the customer” appear on the next
                    estimate you send, and on the invoice.
                  </p>
                  {s.actor.type !== "support" && (
                    <MediaUploader
                      customerId={input.customerId}
                      jobId={selected.id}
                      vehicleId={input.vehicleId ?? null}
                      serviceAssetId={input.serviceAssetId ?? null}
                      defaultTag={flow?.currentInvoice ? "after" : "before"}
                    />
                  )}
                  <MediaGallery
                    items={data.jobMedia}
                    readOnly={s.actor.type === "support"}
                    timeZone={data.profile?.timezone || "America/Chicago"}
                  />
                </section>
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
                          timeZone: data.profile?.timezone || "America/Chicago",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </p>
                  ))}
                  {!data.jobNotes.length && (
                    <p className="muted">
                      Gate codes, what you found, what the customer asked for.
                    </p>
                  )}
                  {s.actor.type !== "support" && (
                    <ActionForm
                      action={addNoteAction}
                      hidden={{
                        customerId: input.customerId,
                        jobId: selected.id,
                        kind: "log",
                      }}
                      submitLabel="Add note"
                      variant="secondary"
                    >
                      <label htmlFor="job-note">Note about this job</label>
                      <textarea
                        id="job-note"
                        name="body"
                        rows={2}
                        required
                        maxLength={5000}
                      />
                    </ActionForm>
                  )}
                </section>
                <section aria-label="Job costs">
                  <h3>Costs &amp; profit</h3>
                  <div className="money-actions">
                    <Link href={`/app/jobs?edit=${selected.id}`}>
                      Edit job / actual hours
                    </Link>
                    <Link href={`/app/customers/${input.customerId}`}>
                      Customer details
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
                  {!flow?.currentInvoice &&
                    s.actor.type !== "support" &&
                    !data.profile?.taxRateConfirmedAt && (
                      <p className="banner" role="note">
                        Your sales tax rate isn’t confirmed yet (currently{" "}
                        {(data.profile?.taxRateBps ?? 0) / 100}%).{" "}
                        <Link href="/app/settings/business#taxPercent">
                          Set your tax rate
                        </Link>{" "}
                        before sending estimates.
                      </p>
                    )}
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
                      Issued invoice and authorization stay linked to this job.
                      Use a separate job for additional billable work.
                    </p>
                  )}
                </section>
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
          <form className="card" method="get">
            <label htmlFor="job-search">Find a job</label>
            <div className="search-controls">
              <input
                id="job-search"
                name="q"
                defaultValue={q ?? ""}
                maxLength={100}
                placeholder="Job or customer name"
              />
              <button className="btn secondary">Search</button>
            </div>
            <input type="hidden" name="show" value={filter.key} />
            <label htmlFor="job-sort">Sort</label>
            <select id="job-sort" name="sort" defaultValue={sort ?? "newest"}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="status">By status</option>
              <option value="amount">Biggest first</option>
            </select>
          </form>
          <nav className="chip-links" aria-label="Show jobs">
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
          </nav>
          <p className="muted">
            Up to 100 recent matching jobs. Search by job or customer name to
            find older work.
          </p>
          <h2>{auto ? "Recent repair jobs" : "Recent job sheets"}</h2>
          {!rows.length && (
            <div className="card">
              <h3>
                {q
                  ? "No matching jobs"
                  : auto
                    ? "No repair jobs yet"
                    : "No jobs yet"}
              </h3>
              <p>
                {q
                  ? "Try another name."
                  : auto
                    ? "Start with a customer and vehicle, add parts and labor, then save the repair job."
                    : "Start with a customer, add materials and labor, then save the job."}
              </p>
            </div>
          )}
          <div className="job-list">
            {rows.map((j) => {
              const input = jobInput.parse(j.data),
                t = calculateJob(input.parts, input.labor);
              return (
                <article key={j.id}>
                  <Link
                    className="card job-row"
                    href={`/app/jobs?job=${j.id}`}
                    aria-label={`Open job: ${j.title} · ${statusLabels[statusOf(j.id)]}`}
                  >
                    <div>
                      <h3>{j.title}</h3>
                      <p className="muted">
                        {
                          data.options.customers.find(
                            (c) => c.id === input.customerId,
                          )?.name
                        }
                      </p>
                      <span className={statusTone(statusOf(j.id))}>
                        {input.repeat && "↻ "}
                        {statusLabels[statusOf(j.id)]}
                      </span>
                      <WorkflowBadges flow={data.workflows.get(j.id)!} />
                    </div>
                    <div className="job-row-meta">
                      <strong>{money(t.subtotalCents)} quoted</strong>
                      <span className="muted">
                        Updated{" "}
                        {j.createdAt.toLocaleDateString("en-US", {
                          timeZone: data.profile?.timezone || "America/Chicago",
                        })}
                      </span>
                    </div>
                    <WorkspaceIcon name="arrow" />
                  </Link>
                </article>
              );
            })}
          </div>
        </>
      )}
    </HydratedMain>
  );
}
