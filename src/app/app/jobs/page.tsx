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
import { loadPipeline, STAGES, type StageKey } from "@/domain/pipeline";
import { jobProfit, myClock } from "@/domain/job-profit";
import { jobAssignees, listTechs } from "@/domain/assignments";
import { assignJobAction } from "@/server/actions/assignments";
import { getInspection } from "@/domain/inspections";
import { InspectionForm } from "@/components/inspection-form";
import { addInspectionToJobAction } from "@/server/actions/inspections";
import { startClockAction, stopClockAction } from "@/server/actions/job-profit";
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
    view?: string;
    tech?: string;
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
    view,
    tech,
  } = await searchParams;
  const boardView = view === "board" && !edit && !job && !creating;
  const s = await requireShopSession("/app/jobs");
  const data = await withTenant(s.businessId, s.actor, async (tx) => {
    const page = {
      selected: edit || job ? await getJob(tx, (edit ?? job)!) : null,
      profile: await getBusinessProfile(tx),
      commonJobs: await listCommonJobs(tx),
      options: await listAppointmentChoices(tx),
      jobs: await listJobs(tx, q ?? ""),
      pipeline: boardView ? await loadPipeline(tx) : null,
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
      profit:
        page.selected && s.role === "owner"
          ? await jobProfit(tx, page.selected.id)
          : null,
      clock: await myClock(tx),
      techs: await listTechs(tx),
      assignee: page.selected
        ? ((await jobAssignees(tx, [page.selected.id])).get(page.selected.id) ??
          null)
        : null,
      inspection: page.selected
        ? await getInspection(tx, page.selected.id)
        : null,
      workflows: await loadJobWorkflows(tx, [
        ...new Set([
          ...page.jobs.map((j) => j.id),
          ...(page.selected ? [page.selected.id] : []),
        ]),
      ]),
    };
  });
  const techName = (id: string) =>
    id === s.actor.id
      ? "Me"
      : (data.techs.find((t) => t.userId === id)?.name ?? "Team member");
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
            tab =
              requestedTab === "notes" || requestedTab === "timeline"
                ? "history"
                : ["inspection", "photos", "files", "history"].includes(
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
                {s.actor.type === "support" ? (
                  <p className="muted">
                    Tech:{" "}
                    {data.techs.find((t) => t.userId === data.assignee)?.name ??
                      "nobody yet"}
                  </p>
                ) : (
                  <div className="tech-pick" key={data.assignee ?? "none"}>
                    <ActionForm
                      action={assignJobAction}
                      hidden={{ jobId: selected.id }}
                      submitLabel="Save tech"
                      variant="secondary"
                    >
                      <label htmlFor="job-tech">Tech on this job</label>
                      <select
                        id="job-tech"
                        name="userId"
                        defaultValue={data.assignee ?? ""}
                      >
                        <option value="">Nobody yet</option>
                        {data.techs.map((t) => (
                          <option key={t.userId} value={t.userId}>
                            {t.userId === s.actor.id
                              ? `${t.name} (me)`
                              : t.name}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                  </div>
                )}
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
                    {data.profit && (
                      <span
                        className={
                          data.profit.profitCents === null
                            ? "profit-chip muted"
                            : data.profit.belowTarget
                              ? "profit-chip low"
                              : "profit-chip good"
                        }
                      >
                        {data.profit.profitCents === null ? (
                          <>Profit: {data.profit.missing[0]}</>
                        ) : (
                          <>
                            <strong>{money(data.profit.profitCents)}</strong>{" "}
                            profit · {(data.profit.marginBps! / 100).toFixed(0)}
                            %
                            {data.profit.belowTarget &&
                              ` (target ${(data.profit.targetBps / 100).toFixed(0)}%)`}
                          </>
                        )}
                      </span>
                    )}
                  </p>
                )}
                {s.actor.type !== "support" && (
                  <div className="action-bar" role="group" aria-label="Add">
                    {data.clock?.jobId === selected.id ? (
                      <ActionForm
                        action={stopClockAction}
                        submitLabel={`■ Stop clock · ${clockText(data.clock.startedAt)}`}
                        variant="secondary"
                      />
                    ) : (
                      <ActionForm
                        action={startClockAction}
                        hidden={{ jobId: selected.id }}
                        submitLabel={
                          data.clock
                            ? "▶ Switch clock to this job"
                            : "▶ Start clock"
                        }
                        variant="secondary"
                      />
                    )}
                    {flow?.currentInvoice &&
                      !flow.currentInvoice.voidedAt &&
                      flow.balanceCents > 0 && (
                        <Link
                          className="btn secondary"
                          href={`/app/checkout?invoiceId=${flow.currentInvoice.id}`}
                        >
                          Check out · {money(flow.balanceCents)}
                        </Link>
                      )}
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
                        "inspection",
                        `Inspection${data.inspection?.counts.fix ? ` (${data.inspection.counts.fix})` : ""}`,
                      ],
                      [
                        "photos",
                        `Photos${data.jobMedia.length ? ` (${data.jobMedia.length})` : ""}`,
                      ],
                      [
                        "files",
                        `Files${data.cabinet.length ? ` (${data.cabinet.length})` : ""}`,
                      ],
                      ["history", "History"],
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
                {tab === "inspection" && data.inspection && (
                  <section aria-label="Inspection">
                    <p className="inspection-summary">
                      <span className="insp-count is-good">
                        {data.inspection.counts.good} good
                      </span>
                      <span className="insp-count is-watch">
                        {data.inspection.counts.watch} watch
                      </span>
                      <span className="insp-count is-fix">
                        {data.inspection.counts.fix} need work
                      </span>
                      {data.inspection.counts.unchecked > 0 && (
                        <span className="muted">
                          {data.inspection.counts.unchecked} not checked
                        </span>
                      )}
                    </p>
                    {data.inspection.pending.length > 0 &&
                      s.actor.type !== "support" && (
                        <ActionForm
                          action={addInspectionToJobAction}
                          hidden={{ jobId: selected.id }}
                          submitLabel={`Add ${data.inspection.pending.length} “needs work” item${data.inspection.pending.length === 1 ? "" : "s"} to the estimate`}
                          variant="secondary"
                        />
                      )}
                    <InspectionForm
                      key={JSON.stringify(data.inspection.items)}
                      jobId={selected.id}
                      initial={data.inspection.items}
                      readOnly={s.actor.type === "support"}
                    />
                  </section>
                )}
                {tab === "history" && (
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
                      {data.profit ? (
                        <>
                          <dl className="profit-sheet">
                            <dt>Sales before tax</dt>
                            <dd>{money(data.profit.salesCents)}</dd>
                            <dt>
                              Costs{" "}
                              <span className="muted">
                                (parts, labor{" "}
                                {data.profit.laborBasis === "clocked"
                                  ? `from ${Math.floor(data.profit.clockedMinutes / 60)}h ${data.profit.clockedMinutes % 60}m clocked`
                                  : data.profit.laborBasis === "actual"
                                    ? "from actual hours"
                                    : "from quoted hours"}
                                {data.profit.cardFeesCents ? ", card fees" : ""}
                                )
                              </span>
                            </dt>
                            <dd>
                              {data.profit.costCents === null
                                ? "—"
                                : `− ${money(data.profit.costCents)}`}
                            </dd>
                            <dt className="profit-total">Profit</dt>
                            <dd className="profit-total">
                              {data.profit.profitCents === null
                                ? "—"
                                : `${money(data.profit.profitCents)} · ${(data.profit.marginBps! / 100).toFixed(0)}%`}
                            </dd>
                          </dl>
                          {data.profit.missing.length > 0 && (
                            <p className="muted">
                              To see profit: {data.profit.missing.join("; ")}.
                            </p>
                          )}
                          {data.profit.belowTarget && (
                            <p className="heads-up-line">
                              ⚠ Below your{" "}
                              {(data.profit.targetBps / 100).toFixed(0)}%
                              target. Check part prices or labor hours before
                              you send it.
                            </p>
                          )}
                        </>
                      ) : (
                        <p>Quoted: {money(t.subtotalCents)}</p>
                      )}
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
                {tab === "history" && flow && (
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
          <div className="view-toggle" role="group" aria-label="Show jobs as">
            <Link
              href="/app/jobs?view=board"
              aria-current={data.pipeline ? "true" : undefined}
            >
              Board
            </Link>
            <Link
              href="/app/jobs"
              aria-current={data.pipeline ? undefined : "true"}
            >
              List
            </Link>
          </div>
          {data.pipeline && data.techs.length > 1 && (
            <div
              className="view-toggle tech-filter"
              role="group"
              aria-label="Whose jobs"
            >
              {[
                { key: "", label: "Everyone" },
                { key: "me", label: "Mine" },
                { key: "none", label: "Nobody yet" },
                ...data.techs
                  .filter((t) => t.userId !== s.actor.id)
                  .map((t) => ({ key: t.userId, label: t.name })),
              ].map((o) => (
                <Link
                  key={o.key || "all"}
                  href={`/app/jobs?view=board${o.key ? `&tech=${o.key}` : ""}`}
                  aria-current={(tech ?? "") === o.key ? "true" : undefined}
                >
                  {o.label}
                </Link>
              ))}
            </div>
          )}
          {data.pipeline ? (
            <div className="job-board" aria-label="Jobs board">
              {STAGES.map((stage) => {
                const want =
                  tech === "me"
                    ? s.actor.id
                    : tech === "none"
                      ? null
                      : tech || undefined;
                const cards = data.pipeline!.columns[
                  stage.key as StageKey
                ].filter((c) => want === undefined || c.techId === want);
                const total = {
                  count: cards.length,
                  cents: cards.reduce((t, c) => t + c.amountCents, 0),
                };
                return (
                  <section
                    key={stage.key}
                    className="board-column"
                    aria-label={BOARD_TITLES(auto)[stage.key as StageKey]}
                  >
                    <h2>
                      {BOARD_TITLES(auto)[stage.key as StageKey]}{" "}
                      <span className="muted">{total.count}</span>
                      <span className="board-total">{money(total.cents)}</span>
                    </h2>
                    {cards.length === 0 && (
                      <p className="muted board-empty">Nothing here</p>
                    )}
                    {cards.map((c) => (
                      <Link
                        key={c.id}
                        href={`/app/jobs?job=${c.id}`}
                        className="board-card"
                        aria-label={`Open job: ${c.title} · ${statusLabels[c.status]}`}
                      >
                        <span className="board-card-top">
                          <strong>
                            {c.repeats && "↻ "}
                            {c.title}
                          </strong>
                          <strong>{money(c.amountCents)}</strong>
                        </span>
                        <span className="muted">
                          {[c.customerName, c.label]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className={boardTone(c.status, c.ageDays)}>
                          {boardNote(c, statusLabels[c.status])}
                        </span>
                        {c.techId && (
                          <span className="board-tech">
                            {techName(c.techId)}
                          </span>
                        )}
                      </Link>
                    ))}
                  </section>
                );
              })}
            </div>
          ) : (
            <>
              <form
                className="inline-search job-search"
                method="get"
                role="search"
              >
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
                        (f.statuses as readonly string[]).includes(
                          statusOf(j.id),
                        ),
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
        </>
      )}
    </HydratedMain>
  );
}

const BOARD_TITLES = (auto: boolean): Record<StageKey, string> => ({
  estimate: auto ? "Estimates" : "Bids",
  approved: auto ? "Approved" : "Won",
  working: auto ? "In the shop" : "In progress",
  invoice: "Ready to invoice",
  unpaid: "Unpaid",
});

// The one line on a board card that says what's going on and for how long.
function boardNote(
  c: { status: string; ageDays: number; nextVisit: Date | null },
  label: string,
) {
  const age =
    c.ageDays === 0 ? "today" : `${c.ageDays} day${c.ageDays === 1 ? "" : "s"}`;
  if (c.status === "draft") return "Not sent yet";
  if (c.status === "sent")
    return `Sent ${age === "today" ? "today" : `${age} ago`}`;
  if (c.status === "won") return "Not scheduled";
  if (c.status === "scheduled" && c.nextVisit)
    return `Booked ${c.nextVisit.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  if (c.status === "invoiced")
    return c.ageDays >= 14
      ? `Overdue · ${age}`
      : `Invoice sent ${age === "today" ? "today" : `${age} ago`}`;
  return label;
}
function boardTone(status: string, ageDays: number) {
  if (status === "invoiced" && ageDays >= 14) return "board-note bad";
  if (
    status === "draft" ||
    status === "won" ||
    status === "unbilled" ||
    status === "invoiced"
  )
    return "board-note warn";
  if (status === "in_progress") return "board-note info";
  return "board-note";
}

// "0:42" since the clock started.
function clockText(started: Date) {
  const m = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
