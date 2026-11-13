import { LogContactButton } from "@/components/correspondence";
import { RecordSection, WorkCard } from "@/components/record-section";
import { CustomerContactActions } from "@/components/customer-contact-actions";
import { TextDraftLink } from "@/components/text-draft-link";
import { CopyTextButton } from "@/components/copy-text-button";
import { groupWork } from "@/lib/work-sections";
import { FileUploader } from "@/components/file-uploader";
import { jobReference } from "@/lib/job-reference";
import { JOB_FILE_CATEGORIES } from "@/domain/documents";
import { sendDocumentAction } from "@/server/actions/documents";
import { FileCabinet } from "@/components/file-cabinet";
import { jobCabinet, listTemplates } from "@/domain/documents";
import { getDocumentShare } from "@/domain/document-sharing";
import { AppError } from "@/lib/errors";
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
import { getBusinessProfile } from "@/domain/business-profile";
import { and, eq } from "drizzle-orm";
import { appointment, estimateVersion, recommendation } from "@/db/schema";
import { EstimatePublisher } from "@/components/estimate-publisher";
import Link from "next/link";
import { calculateJob } from "@/domain/job-costing";
import { jobInput } from "@/domain/jobs";
import { loadPipeline, STAGES, type StageKey } from "@/domain/pipeline";
import { jobProfit, myClock } from "@/domain/job-profit";
import { jobAssignees, listTechs, listAdvisors } from "@/domain/assignments";
import { assignedAdvisorForJob } from "@/domain/job-handoffs";
import { partCatalog } from "@/domain/parts";
import { jobDeposit } from "@/domain/deposits";
import { startDepositAction } from "@/server/actions/deposits";
import {
  assignJobAction,
  assignAdvisorAction,
} from "@/server/actions/assignments";
import { getInspection } from "@/domain/inspections";
import { withInspectionRecommendations } from "@/lib/inspection-estimate";
import { InspectionForm } from "@/components/inspection-form";
import { RoCosts } from "@/components/ro-costs";
import { startClockAction, stopClockAction } from "@/server/actions/job-profit";
import { withTenant } from "@/db/tenant";
import { listAppointmentChoices } from "@/domain/appointments";
import { getJob, listJobs } from "@/domain/jobs";
import { JobEditor } from "@/components/job-editor";
import { RoEstimateBuilder } from "@/components/ro-estimate-builder";
import { canManageTeam } from "@/domain/membership";
import { RoCheckinEditor } from "@/components/ro-checkin-editor";
import { RoStageSummary } from "@/components/ro-stage-summary";
import { requireShopSession } from "@/server/views/shop";

const followUpPath = (jobId: string) => `/app/tasks?add=1&jobId=${jobId}`;

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
    share?: string;
    view?: string;
    tech?: string;
    mode?: string;
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
    share,
    view,
    tech,
    mode,
  } = await searchParams;
  const boardView = view === "board" && !edit && !job && !creating;
  const s = await requireShopSession("/app/jobs");
  const canFollowUp = s.actor.type === "user" && s.role !== "technician";
  // Owners can wear both hats without creating a second login. Technician
  // mode is explicitly selected and restricted to ROs assigned to that owner.
  const ownerAsTechnician =
    s.role === "owner" && s.actor.type === "user" && mode === "technician";
  const technicianWorkspace = s.role === "technician" || ownerAsTechnician;
  // Technicians see only the jobs they're on; the same rule applies to an
  // owner intentionally viewing the technician workspace.
  const techOnly =
    technicianWorkspace && s.actor.type === "user"
      ? (s.actor.id ?? undefined)
      : undefined;
  const data = await withTenant(s.businessId, s.actor, async (tx) => {
    const wanted = edit ?? job;
    const allowed =
      !wanted ||
      !techOnly ||
      (await jobAssignees(tx, [wanted])).get(wanted) === techOnly;
    const page = {
      selected: wanted && allowed ? await getJob(tx, wanted) : null,
      profile: await getBusinessProfile(tx),
      commonJobs: await listCommonJobs(tx),
      options: await listAppointmentChoices(tx),
      jobs: await listJobs(tx, q ?? "", techOnly),
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
    const [cabinet, [contact], workflows] = await Promise.all([
      page.selected
        ? jobCabinet(tx, page.selected.id, (c) => {
            try {
              return c ? openShareToken(c) : null;
            } catch {
              return null;
            }
          })
        : [],
      selectedCustomer
        ? tx
            .select({
              firstName: customerTable.firstName,
              phone: customerTable.phoneE164,
              email: customerTable.email,
              status: customerTable.status,
              textOff: customerTable.textOptedOutAt,
              emailOff: customerTable.emailOptedOutAt,
              doNotContact: customerTable.doNotContact,
            })
            .from(customerTable)
            .where(
              and(
                eq(customerTable.businessId, tx.businessId),
                eq(customerTable.id, selectedCustomer),
              ),
            )
        : [],
      loadJobWorkflows(tx, [
        ...new Set([
          ...page.jobs.map((j) => j.id),
          ...(page.selected ? [page.selected.id] : []),
        ]),
      ]),
    ]);
    const latest = page.selected
      ? workflows.get(page.selected.id)?.latest?.estimate
      : undefined;
    let estimateDraftPath: string | undefined;
    if (
      canFollowUp &&
      contact?.status === "active" &&
      contact.phone &&
      !contact.textOff &&
      !contact.doNotContact &&
      latest &&
      latest.customerId === selectedCustomer &&
      cabinet.some((item) => item.estimateShareId === latest.id)
    ) {
      try {
        estimateDraftPath = (await getDocumentShare(tx, latest.id, "estimate"))
          .path;
      } catch (error) {
        // Older links can require replacement. Keep sharing available from Docs.
        if (!(error instanceof AppError)) throw error;
      }
    }
    // The open customer estimate, for presenting it on this screen or an iPad.
    let presentPath: string | undefined;
    const latestFlow = page.selected
      ? workflows.get(page.selected.id)?.latest
      : undefined;
    if (
      s.role !== "technician" &&
      s.actor.type === "user" &&
      latestFlow &&
      !latestFlow.authorization
    ) {
      try {
        presentPath = (
          await getDocumentShare(tx, latestFlow.estimate.id, "estimate")
        ).path;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
      }
    }
    return {
      ...page,
      cabinet,
      contact,
      estimateDraftPath,
      presentPath,
      workflows,
      templates: page.selected ? await listTemplates(tx) : [],
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
      // Costs and profit: everyone at the front counter, never technicians.
      profit:
        page.selected && s.role !== "technician"
          ? await jobProfit(tx, page.selected.id)
          : null,
      clock: await myClock(tx),
      deposit: page.selected ? await jobDeposit(tx, page.selected.id) : null,
      techs: await listTechs(tx),
      canManageTeam: await canManageTeam(tx),
      advisors: s.role === "technician" ? [] : await listAdvisors(tx),
      advisorId:
        page.selected && s.role !== "technician"
          ? await assignedAdvisorForJob(tx, page.selected.id)
          : null,
      catalog: edit || creating ? await partCatalog(tx) : [],
      assignee: page.selected
        ? ((await jobAssignees(tx, [page.selected.id])).get(page.selected.id) ??
          null)
        : null,
      inspection: page.selected
        ? await getInspection(tx, page.selected.id)
        : null,
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
    (edit && !selected?.documentOnly) ||
    creating === "1" ||
    customerId ||
    sourceRecoveryItemId ||
    sourceAppointmentId
  );
  const statusLabels = jobStatusLabels(type);
  const statusOf = (id: string) => jobStatus(data.workflows.get(id)!);
  const estimateName = auto ? "estimate" : "bid";
  const shopName = data.profile?.dba || data.profile?.legalName || "the shop";
  const draftPhone =
    canFollowUp &&
    data.contact?.status === "active" &&
    !data.contact.textOff &&
    !data.contact.doNotContact
      ? data.contact.phone
      : null;
  const greeting = data.contact?.firstName
    ? `Hi ${data.contact.firstName},`
    : "Hi,";
  // ?stage=plan (older links) shows recurring jobs.
  const filter = jobFilter(
    show ?? (stage?.startsWith("plan") ? "recurring" : undefined),
  );
  const totalOf = (id: string) => {
    const f = data.workflows.get(id)!;
    return (
      (f.currentInvoice ? f.paidCents + f.balanceCents : undefined) ??
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
  // Populate pricing lines only in the advisor’s estimate draft, after the
  // technician has submitted a complete inspection. Earlier RO stages stay
  // untouched and no quote is priced or published on the technician’s behalf.
  const estimateInitial =
    selected && initial && auto && data.inspection?.complete
      ? withInspectionRecommendations(initial, data.inspection.items)
      : initial;
  const money = (c: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(c / 100);
  const canChooseInitialTech =
    s.actor.type === "user" &&
    !data.assignee &&
    data.advisorId === s.actor.id;
  const advisorAssignment =
    selected && s.role !== "technician" && s.actor.type !== "support" ? (
      data.canManageTeam ? (
        <div className="tech-pick" key={data.advisorId ?? "advisor-unset"}>
          <ActionForm
            action={assignAdvisorAction}
            hidden={{ jobId: selected.id }}
            submitLabel="Assign advisor"
            variant="secondary"
          >
            <label htmlFor="job-advisor">Service advisor for this RO</label>
            <select
              id="job-advisor"
              name="userId"
              defaultValue={data.advisorId ?? s.actor.id ?? ""}
              required
            >
              <option value="">Choose advisor</option>
              {data.advisors.map((a) => (
                <option value={a.userId} key={a.userId}>
                  {a.name}
                </option>
              ))}
            </select>
          </ActionForm>
          <p className="muted">
            When the inspection is submitted, this advisor receives the Build
            Estimate task.
          </p>
        </div>
      ) : (
        <p className="muted">
          Assigned advisor:{" "}
          {data.advisors.find((a) => a.userId === data.advisorId)?.name ??
            "Not assigned"}
        </p>
      )
    ) : null;
  // Technicians get a dedicated assigned-work workspace. The general RO
  // editor, profit, invoices, estimates, customer administration and
  // advisor-only actions are never rendered for technician sessions.
  if (technicianWorkspace) {
    const assignedInput = selected ? jobInput.parse(selected.data) : null;
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <h1>My technician work</h1>
        <p className="muted">
          Only technician work assigned to your account appears here.
        </p>
        {ownerAsTechnician && (
          <Link className="btn secondary" href={selected ? `/app/jobs?job=${selected.id}` : "/app/jobs"}>
            Return to advisor / owner view
          </Link>
        )}
        {selected ? (
          <>
            <Link href={ownerAsTechnician ? "/app/jobs?mode=technician" : "/app/jobs"}>← My assigned ROs</Link>
            <section className="card">
              <h2>{assignedInput?.title || "Repair order"}</h2>
              {(assignedInput?.concerns ||
                assignedInput?.mileageIn != null) && (
                <div className="ro-check-in" aria-label="Check-in">
                  {assignedInput?.concerns && (
                    <p>
                      <strong>Customer concerns:</strong>{" "}
                      {assignedInput.concerns}
                    </p>
                  )}
                  {assignedInput?.mileageIn != null && (
                    <p>
                      <strong>Miles in:</strong>{" "}
                      {assignedInput.mileageIn.toLocaleString("en-US")}
                    </p>
                  )}
                </div>
              )}
              <p className="muted">
                Inspect each system, add an evidence photo only when you find a
                problem, then record a brief summary and submit to your advisor.
              </p>
              {data.inspection && (
                <InspectionForm
                  key={selected.id}
                  jobId={selected.id}
                  customerId={assignedInput!.customerId}
                  vehicleId={assignedInput!.vehicleId ?? null}
                  serviceAssetId={assignedInput!.serviceAssetId ?? null}
                  initial={data.inspection.items}
                  initialAssessment={data.inspection.assessment}
                  automotive={auto}
                  readOnly={
                    s.actor.type === "support" || data.inspection.complete
                  }
                  completed={data.inspection.complete}
                />
              )}
            </section>

          </>
        ) : (
          <>
            {data.jobs.length === 0 ? (
              <p>
                No repair orders assigned. You will receive a task when your
                advisor assigns a vehicle.
              </p>
            ) : (
              <ul className="row-list card">
                {data.jobs.map((j) => (
                  <li key={j.id}>
                    <Link href={ownerAsTechnician ? `/app/jobs?job=${j.id}&mode=technician` : `/app/jobs?job=${j.id}`}>
                      <strong>
                        {(j.data as { title?: string }).title || "Repair order"}
                      </strong>
                      <span className="muted"> · Open inspection</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </HydratedMain>
    );
  }
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>
        {editing
          ? selected
            ? isAutomotive(type)
              ? "Edit RO"
              : "Edit job"
            : auto
              ? "New RO"
              : labels.newJob
          : isAutomotive(type)
            ? "Repair orders"
            : labels.jobs}
      </h1>

      {editing &&
      selected &&
      auto &&
      !data.inspection?.complete &&
      !data.workflows.get(selected.id)?.latest ? (
        <section className="card">
          <h2>Inspection required first</h2>
          <p>
            The technician must submit the inspection before the advisor builds
            the estimate. Assign the technician from this RO.
          </p>
          <Link className="btn primary" href={`/app/jobs?job=${selected.id}`}>
            Return to RO
          </Link>
        </section>
      ) : editing ? (
        <>
          <p>
            <Link
              href={selected ? `/app/jobs?job=${selected.id}` : "/app/jobs"}
            >
              ← Back to {selected ? "job" : "jobs"}
            </Link>
          </p>
          {auto && !selected ? (
            <RoCheckinEditor
              key={[customerId, vehicleId, sourceAppointmentId].join(":")}
              options={data.options}
              advisors={data.advisors}
              canManage={data.canManageTeam}
              currentUserId={s.actor.id ?? ""}
              initial={initial}
              attachMediaId={
                data.fromMedia && data.fromMedia.customerId === customerId
                  ? data.fromMedia.id
                  : undefined
              }
            />
          ) : auto && selected && data.inspection?.complete && estimateInitial ? (
            <RoEstimateBuilder
              key={selected.version}
              initial={jobInput.parse(estimateInitial)}
              laborRateCents={data.profile?.laborSellRateCents}
              laborCostCents={data.profile?.laborCostRateCents}
              partsTaxable={data.profile?.partsTaxableDefault}
            />
          ) : (
            <JobEditor
              commonJobs={data.commonJobs}
              catalog={data.catalog}
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
              inspectionPricingOnly={auto && !!selected && !!data.inspection?.complete}
              initial={estimateInitial}
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
          )}
        </>
      ) : selected && mode === "customer" ? (
        (() => {
          const input = jobInput.parse(selected.data);
          const totals = calculateJob(input.parts, input.labor);
          const customerName =
            data.options.customers.find((item) => item.id === input.customerId)
              ?.name ?? "Customer";
          const assetName =
            flow?.latest?.estimate.snapshot.serviceLabel ||
            flow?.latest?.estimate.snapshot.vehicleLabel ||
            "";
          return (
            <section
              className="card"
              aria-label="Customer-facing repair order"
              data-ro-mode="customer"
            >
              <div className="profile-head">
                <div>
                  <p className="muted">
                    Customer-facing view · RO #
                    {selected.id.slice(0, 8).toUpperCase()}
                  </p>
                  <h2>{selected.title}</h2>
                  <p>
                    {customerName}
                    {assetName ? ` · ${assetName}` : ""}
                    {input.mileageIn != null &&
                      ` · ${input.mileageIn.toLocaleString("en-US")} miles`}
                  </p>
                  {input.concerns && (
                    <p>
                      <strong>Your concerns:</strong> {input.concerns}
                    </p>
                  )}
                </div>
                {flow && (
                  <span className={statusTone(statusOf(selected.id))}>
                    {statusLabels[statusOf(selected.id)]}
                  </span>
                )}
              </div>
              <p className="muted">
                Customer prices only. This is a staff presentation view; use the
                estimate workflow to send an official authorization document.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Work</th>
                      <th>Quantity / hours</th>
                      <th>Customer price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {input.parts.map((line, i) => (
                      <tr key={`part-${i}`}>
                        <td>{line.description}</td>
                        <td>{line.quantity}</td>
                        <td>
                          {money(
                            Math.round(line.quantity * line.unitPriceCents),
                          )}
                        </td>
                      </tr>
                    ))}
                    {input.labor.map((line, i) => (
                      <tr key={`labor-${i}`}>
                        <td>{line.description}</td>
                        <td>
                          {(line.estimatedHoursHundredths / 100).toFixed(2)}{" "}
                          hours
                        </td>
                        <td>
                          {money(
                            Math.round(
                              (line.estimatedHoursHundredths *
                                line.sellRateCents) /
                                100,
                            ),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={2}>
                        Subtotal before applicable taxes and fees
                      </th>
                      <th>{money(totals.subtotalCents)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p>
                <Link
                  className="btn secondary"
                  href={`/app/customers/${input.customerId}`}
                >
                  Customer history
                </Link>
              </p>
              <div
                className="ro-view-switch"
                aria-label="Repair order display mode"
              >
                <span>Costs and profit are hidden.</span>
                <Link
                  className="btn secondary"
                  href={`/app/jobs?job=${selected.id}`}
                >
                  Show costs
                </Link>
              </div>
            </section>
          );
        })()
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
                : ["inspection", "photos", "estimate", "files", "history"].includes(
                      requestedTab ?? "",
                    )
                  ? requestedTab!
                  : "work";
          // An automotive RO begins with check-in and technician inspection.
          // Existing published ROs retain their document access.
          const awaitingInspection =
            auto && !data.inspection?.complete && !flow?.latest;
          const pricingReady =
            (input.parts.length > 0 || input.labor.length > 0) &&
            input.parts.every((part) => part.description.trim() && part.quantity > 0 &&
              part.unitCostCents !== null) &&
            input.labor.every((line) => line.description.trim() &&
              (!line.fromInspection || (line.sellRateCents > 0 && line.costRateCents !== null)));
          return (
            <>
              <p>
                <Link href={`/app/customers/${input.customerId}`}>
                  ← {customerName}
                </Link>
              </p>
              {selected.documentOnly && (
                <p className="notice">
                  This older job was recovered from its estimate. Its customer
                  documents and payments are available, but its original parts
                  and labor costs were not recorded. Profit is unknown.
                </p>
              )}
              {saved === "1" && (
                <p role="status" className="notice ok">
                  {auto && data.inspection?.complete
                    ? "Estimate pricing saved. Review the customer preview under Estimate."
                    : "Repair order saved."}
                </p>
              )}
              {!auto && data.profit && (
                <div
                  className="ro-view-switch"
                  aria-label="Repair order display mode"
                >
                  <Link
                    className="btn secondary"
                    href={`/app/jobs?job=${selected.id}&mode=customer`}
                  >
                    Hide costs (customer view)
                  </Link>
                </div>
              )}
              <article className="card job-profile record-job-profile">
                <CustomerContactActions
                  target={{ customerId: input.customerId, jobId: selected.id }}
                  phone={data.contact?.phone}
                  email={data.contact?.email}
                  textAllowed={
                    !data.contact?.textOff && !data.contact?.doNotContact
                  }
                  emailAllowed={
                    !data.contact?.emailOff && !data.contact?.doNotContact
                  }
                />
                <header className="profile-head">
                  <div>
                    <div className="identifier-with-copy">
                      <p className="customer-job-ref">
                        {jobReference(selected.id, isAutomotive(type))}
                      </p>
                      <CopyTextButton
                        value={jobReference(selected.id, isAutomotive(type))}
                        label={`Copy ${auto ? "RO" : "job"} number`}
                      />
                    </div>
                    <h2 className="profile-title">
                      {auto ? (
                        "Repair order"
                      ) : (
                        <>
                          {input.repeat && "↻ "}
                          {selected.title}
                        </>
                      )}
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
                {(input.concerns || input.mileageIn != null) && (
                  <div className="ro-check-in" aria-label="Check-in">
                    {input.mileageIn != null && (
                      <p>
                        <strong>Miles in:</strong>{" "}
                        {input.mileageIn.toLocaleString("en-US")}
                      </p>
                    )}
                    {input.concerns && (
                      <p>
                        <strong>Customer concerns:</strong> {input.concerns}
                      </p>
                    )}
                  </div>
                )}
                {auto && (
                  <RoStageSummary
                    inspectionComplete={!!data.inspection?.complete}
                    hasEstimate={!!flow?.latest}
                    technicianAssigned={!!data.assignee}
                    stage={flow?.stage}
                    statusLabel={statusLabels[statusOf(selected.id)]}
                    editHref={`/app/jobs?edit=${selected.id}`}
                    documentsHref={`/app/jobs?job=${selected.id}&tab=files`}
                  />
                )}
                {data.presentPath && (
                  <p className="ro-present">
                    <a
                      className="btn primary"
                      href={data.presentPath}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Present estimate on this screen
                    </a>
                    <span className="muted">
                      Opens the customer&apos;s review: their request, the
                      inspection, then the recommendations. Hand them the iPad
                      or cast it.
                    </span>
                  </p>
                )}
                {canFollowUp && (
                  <div className="job-follow-up-shortcuts">
                    <LogContactButton
                      target={{
                        customerId: input.customerId,
                        jobId: selected.id,
                      }}
                    />
                    <Link
                      href={followUpPath(selected.id)}
                      className="btn secondary"
                    >
                      Follow up
                    </Link>
                    {draftPhone && data.estimateDraftPath && (
                      <TextDraftLink
                        target={{
                          customerId: input.customerId,
                          jobId: selected.id,
                        }}
                        phone={draftPhone}
                        label={`Text ${estimateName} ready`}
                        message={`${greeting} your ${estimateName} from ${shopName} is ready to review and approve.`}
                        summary={`Shared the ${estimateName} approval link.`}
                        approvalPath={data.estimateDraftPath}
                      />
                    )}
                    {draftPhone && flow?.work === "completed" && (
                      <TextDraftLink
                        target={{
                          customerId: input.customerId,
                          jobId: selected.id,
                        }}
                        phone={draftPhone}
                        label={
                          auto ? "Text ready for pickup" : "Text work complete"
                        }
                        summary={
                          auto ? "Vehicle ready for pickup." : "Work complete."
                        }
                        message={
                          auto
                            ? `${greeting} your vehicle is ready for pickup at ${shopName}.`
                            : `${greeting} ${shopName} has completed the work. Please let us know if you have any questions.`
                        }
                      />
                    )}
                  </div>
                )}
                {auto && awaitingInspection && !data.inspection?.assessment.vehiclePickedUp && (
                  <details className="ro-intake-photos">
                    <summary>Check-in photos — document existing body damage (optional)</summary>
                    <p className="muted">
                      Take exterior photos before handing the vehicle to the
                      technician. These stay in this RO and are not sent to the customer.
                    </p>
                    <MediaUploader
                      purpose="intake"
                      customerId={input.customerId}
                      jobId={selected.id}
                      vehicleId={input.vehicleId ?? null}
                      serviceAssetId={input.serviceAssetId ?? null}
                    />
                    <p className="muted">
                      {data.jobMedia.filter((m) => m.tag === "before").length} check-in photo(s) recorded.
                    </p>
                  </details>
                )}
                {!auto && !awaitingInspection && (
                  <nav
                    className="section-tabs"
                    aria-label="Estimate preparation and customer approval"
                  >
                    <Link
                      href={`/app/jobs?edit=${selected.id}`}
                      aria-current={undefined}
                    >
                      Build estimate
                    </Link>
                    <Link
                      href={`/app/jobs?job=${selected.id}&tab=files`}
                      aria-current={tab === "files" ? "page" : undefined}
                    >
                      Preview documents
                    </Link>
                    <Link
                      href={`/app/jobs?job=${selected.id}&tab=files&share=1#share-customer-packet`}
                      aria-label="Share customer packet"
                    >
                      Share with customer
                    </Link>
                  </nav>
                )}
                {!auto && !awaitingInspection && (
                  <p className="muted">
                    Review the technician&apos;s findings, build the estimate,
                    then send the customer their approval link.
                  </p>
                )}
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
                {data.deposit && (
                  <div className="notice deposit-due" role="status">
                    <p>
                      <strong>
                        Deposit due: {money(data.deposit.depositCents)}
                      </strong>{" "}
                      ({data.deposit.percent}% of{" "}
                      {money(data.deposit.approvedCents)} approved). Take it
                      before you start.
                    </p>
                    {s.actor.type !== "support" && true && (
                      <ActionForm
                        action={startDepositAction}
                        hidden={{ jobId: selected.id }}
                        submitLabel={`Invoice and take ${money(data.deposit.depositCents)} deposit`}
                        variant="secondary"
                      />
                    )}
                  </div>
                )}
                {!data.canManageTeam && !canChooseInitialTech ? (
                  <p className="muted">
                    Tech:{" "}
                    {data.techs.find((t) => t.userId === data.assignee)?.name ??
                      "nobody yet"}
                  </p>
                ) : (
                  <div
                    className="tech-pick ro-assignment"
                    key={data.assignee ?? "none"}
                  >
                    <ActionForm
                      action={assignJobAction}
                      hidden={{ jobId: selected.id }}
                      submitLabel={data.assignee ? "Change technician" : "Assign technician"}
                      variant="secondary"
                    >
                      <label htmlFor="job-tech">Technician for this RO (all repairs)</label>
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
                {advisorAssignment}
                {s.role === "owner" && data.assignee === s.actor.id && (
                  <Link
                    className="btn secondary"
                    href={`/app/jobs?job=${selected.id}&mode=technician`}
                  >
                    Work this RO as technician
                  </Link>
                )}
                {flow && (!awaitingInspection || flow.latest) && (
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
                {!auto && !awaitingInspection && s.actor.type !== "support" && (
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
                    {true &&
                      flow &&
                      flow.supplementDueCents > 0 &&
                      flow.latest?.authorization && (
                        <Link
                          className="btn secondary"
                          href={`/app/invoices?new=1&versionId=${flow.latest.estimate.id}`}
                        >
                          Bill extra work · {money(flow.supplementDueCents)}
                        </Link>
                      )}
                    {true &&
                      flow?.currentInvoice &&
                      flow.balanceCents > 0 &&
                      (() => {
                        // The first of the job's invoices with money due.
                        const due = [
                          flow.currentInvoice,
                          ...flow.addOnInvoices,
                        ].find(
                          (i) =>
                            i.totalCents >
                            flow.entries
                              .filter((p) => p.invoiceId === i.id)
                              .reduce((t, p) => t + p.amountCents, 0),
                        );
                        return due ? (
                          <Link
                            className="btn secondary"
                            href={`/app/checkout?invoiceId=${due.id}`}
                          >
                            Check out · {money(flow.balanceCents)}
                          </Link>
                        ) : null;
                      })()}
                    {(
                      [
                        ["note", "+ Note"],
                        ["photo", "+ Photo / video"],
                        ["file", "+ File"],
                        ["sign", "✍ Add agreement"],
                      ] as const
                    )
                      .filter(
                        ([key]) => true || key === "note" || key === "photo",
                      )
                      .map(([key, label]) => (
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
                    <h3>Prepare a document for signature</h3>
                    <p>
                      Choose a shop-prepared agreement. The customer may review
                      it and sign, but cannot change the work or price. The file
                      is saved to this job first.
                    </p>
                    {data.templates.length ? (
                      <ActionForm
                        action={sendDocumentAction}
                        hidden={{ jobId: selected.id }}
                        submitLabel="Prepare & open document packet"
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
                      After preparation, you’ll return to the job’s file cabinet
                      to copy or share the signing link. This step does not send
                      a message automatically.
                    </p>
                    <Link href={`/app/jobs?job=${selected.id}&tab=files`}>
                      Done
                    </Link>
                  </section>
                )}
                <nav className="section-tabs" aria-label="RO records">
                  {(awaitingInspection
                    ? ([["work", "Next step"], ["history", "History"]] as const)
                    : [
                      ["work", "Overview"],
                      ...(auto ? ([["estimate", "Estimate"]] as const) : []),
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
                        `Documents${data.cabinet.length ? ` (${data.cabinet.length})` : ""}`,
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
                    {awaitingInspection && (
                      <section className="ro-stage-panel" aria-label="Next required action">
                        <h3>Next: Complete the inspection</h3>
                        <p>Assign an advisor and technician above. The assigned technician completes the inspection on their own screen. Nothing is ready to price or send yet.</p>
                        {s.role === "owner" && data.assignee === s.actor.id && (
                          <Link className="btn primary" href={`/app/jobs?job=${selected.id}&mode=technician`}>
                            Start technician inspection
                          </Link>
                        )}
                      </section>
                    )}
                    {!awaitingInspection && flow && (
                      <RecordSection
                        title="Work & approval"
                        description="Customer authorization, the next step and progress on this job."
                      >
                        <JobWorkflow
                          flow={flow}
                          jobId={selected.id}
                          timezone={data.profile?.timezone || "America/Chicago"}
                          readOnly={s.actor.type === "support"}
                          technicianOnly={false}
                          canEditEstimate={!selected.documentOnly}
                        />
                      </RecordSection>
                    )}
                    {!auto && !awaitingInspection && data.profit && (
                      <RecordSection
                        title="Costs & profit"
                        description="What each line costs the shop and what it makes. Hidden in the customer view."
                      >
                        <RoCosts profit={data.profit} />
                      </RecordSection>
                    )}
                  </>
                )}
                {tab === "estimate" && auto && (
                  <section className="ro-estimate-workspace" id="job-estimate" aria-label="Estimate and customer preview">
                    <p className="muted">STEP 2 OF 3 · CUSTOMER ESTIMATE</p>
                    <h3>Review the estimate</h3>
                    {!data.inspection?.complete ? (
                      <>
                        <p>The technician must submit the inspection before an estimate can be prepared.</p>
                        <Link className="btn secondary" href={`/app/jobs?job=${selected.id}`}>Return to RO</Link>
                      </>
                    ) : (
                      <>
                        {flow?.latest && !flow.changedSinceEstimate ? (
                          <p className="notice ok" role="status">
                            Estimate version {flow.latest.estimate.version} is saved in Documents.
                            {flow.latest.authorization ? " Customer response received." : " Preview and send the prepared document, or check for the customer response."}
                          </p>
                        ) : (
                          <p className="notice" role="status">
                            {flow?.latest
                              ? "Changes to the RO need a revised estimate before they can be sent."
                              : "Draft pricing — not yet prepared or sent to the customer."}
                          </p>
                        )}
                        <section className="ro-estimate-preview" aria-label="Customer-facing estimate preview">
                          <p className="muted">PREVIEW · RO #{selected.id.slice(0, 8).toUpperCase()}</p>
                          <h4>{selected.title}</h4>
                          <p>{customerName}{input.mileageIn != null
                            ? ` · ${input.mileageIn.toLocaleString("en-US")} miles`
                            : ""}</p>
                          {input.concerns && <p><strong>Customer concern:</strong> {input.concerns}</p>}
                          <div className="table-wrap"><table>
                            <thead><tr><th>Work / item</th><th>Customer price</th></tr></thead>
                            <tbody>
                              {input.parts.map((p, i) => (
                                <tr key={`part-${i}`}>
                                  <td>{p.description} · Qty {p.quantity}</td>
                                  <td>{money(Math.round(p.quantity * p.unitPriceCents))}</td>
                                </tr>
                              ))}
                              {input.labor.map((l, i) => (
                                <tr key={`labor-${i}`}>
                                  <td>{l.description} · {(l.estimatedHoursHundredths / 100).toFixed(2)} labor hours</td>
                                  <td>{money(Math.round(l.estimatedHoursHundredths * l.sellRateCents / 100))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table></div>
                          <p><strong>Subtotal before tax: {money(t.subtotalCents)}</strong></p>
                          <p className="muted">The final customer document also includes the completed inspection, advisor-approved media, taxes, and Approve / Decline choices for every line.</p>
                        </section>
                        <div className="money-actions">
                          <Link className="btn secondary" href={`/app/jobs?edit=${selected.id}`}>
                            Edit parts and labor
                          </Link>
                          <Link className="btn secondary" href={`/app/jobs?job=${selected.id}&tab=files`}>
                            All RO documents ({data.cabinet.length})
                          </Link>
                        </div>
                        {!pricingReady && (
                          <p className="notice">Pricing is incomplete. Open Edit parts and labor to finish the costs and selling prices before preparing a customer document.</p>
                        )}
                        {s.actor.type !== "support" && !selected.documentOnly &&
                          pricingReady &&
                          (!flow?.latest || flow.changedSinceEstimate) && (
                            <section className="record-details">
                              <h4>Prepare customer estimate</h4>
                              <p>Preparing saves a fixed customer document, then opens Documents for preview and sending. No message is sent automatically.</p>
                              <EstimatePublisher
                                taxRateBps={flow?.currentInvoice
                                  ? flow.currentInvoice.snapshot.taxBps
                                  : data.profile?.taxRateBps}
                                jobId={selected.id}
                                version={selected.version}
                                existingVersion={flow?.latest?.estimate.version}
                                requiresChangeReason={!!flow?.latest?.authorization || !!flow?.currentInvoice}
                                pendingChanges={flow?.changedSinceEstimate}
                              />
                            </section>
                          )}
                        {flow?.latest && !flow.changedSinceEstimate && (
                          <Link className="btn primary" href={`/app/jobs?job=${selected.id}&tab=files&share=1`}>
                            Preview and share saved estimate
                          </Link>
                        )}
                      </>
                    )}
                  </section>
                )}
                {tab === "photos" && (
                  <>
                    <section aria-label="Photos and videos" id="job-photos">
                      <h3>Photos &amp; videos</h3>
                      <p className="muted">
                        Technician uploads stay private until the service
                        advisor approves them for the next estimate or invoice.
                      </p>
                      <MediaGallery
                        quoteHref={
                          false
                            ? undefined
                            : (m) =>
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
                        canPublish={true}
                        readOnly={s.actor.type === "support"}
                        timeZone={data.profile?.timezone || "America/Chicago"}
                      />
                    </section>
                  </>
                )}
                {tab === "files" && (
                  <>
                    <section
                      className="docs-prep-toolbar"
                      aria-label="Documents setup"
                      id="share-customer-packet"
                    >
                      <div>
                        <p className="muted">STEP 3 OF 3 · CUSTOMER DOCUMENTS</p>
                        <h3>Estimate &amp; Documents</h3>
                        {!flow?.latest?.estimate && (
                          <p className="muted">
                            No customer estimate is prepared yet. Build and review it first.
                          </p>
                        )}
                      </div>
                      {auto && data.inspection?.complete && (
                        <Link className="btn secondary" href={`/app/jobs?job=${selected.id}&tab=estimate`}>
                          {flow?.latest ? "Review estimate" : "Build customer estimate"}
                        </Link>
                      )}
                      {s.actor.type !== "support" && (
                        <details className="docs-add-menu">
                          <summary className="btn secondary">
                            + Add agreement
                          </summary>
                          {data.templates.length ? (
                            <ActionForm
                              action={sendDocumentAction}
                              hidden={{ jobId: selected.id }}
                              submitLabel="Add to documents"
                              variant="secondary"
                            >
                              <label htmlFor="docs-template">Agreement</label>
                              <select
                                id="docs-template"
                                name="templateId"
                                required
                              >
                                {data.templates.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                            </ActionForm>
                          ) : (
                            <Link href="/app/settings/documents">
                              Set up document templates
                            </Link>
                          )}
                        </details>
                      )}
                    </section>
                    <FileCabinet
                      items={data.cabinet}
                      autoOpenShare={share === "1"}
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
                      readOnly={s.actor.type === "support" || false}
                      timeZone={data.profile?.timezone || "America/Chicago"}
                    />
                  </>
                )}
                {tab === "inspection" && data.inspection && (
                  <section aria-label="Inspection">
                    <p className="inspection-summary">
                      <span className="insp-count is-good">
                        {data.inspection.counts.good} pass
                      </span>
                      <span className="insp-count is-watch">
                        {data.inspection.counts.watch} caution
                      </span>
                      <span className="insp-count is-fix">
                        {data.inspection.counts.fix} fail
                      </span>
                      {data.inspection.counts.unchecked > 0 && (
                        <span className="muted">
                          {data.inspection.counts.unchecked} not checked
                        </span>
                      )}
                    </p>
                    <InspectionForm
                      key={selected.id}
                      jobId={selected.id}
                      customerId={input.customerId}
                      vehicleId={input.vehicleId ?? null}
                      serviceAssetId={input.serviceAssetId ?? null}
                      initial={data.inspection.items}
                      initialAssessment={data.inspection.assessment}
                      automotive={auto}
                      readOnly
                      completed={data.inspection.complete}
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
                {tab === "work" && !auto && (
                  <>
                    <section aria-label="Job costs">
                      <h3>Job-sheet costs &amp; profit</h3>
                      <p className="muted">
                        This uses the current job sheet, recorded time and
                        estimated card fees. Money and Reports use approved
                        invoice lines and quote-time costs instead.
                      </p>
                      <div className="money-actions">
                        {!selected.documentOnly && (
                          <Link href={`/app/jobs?edit=${selected.id}`}>
                            Edit job / actual hours
                          </Link>
                        )}
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
                      {flow?.currentInvoice && (
                        <p className="notice" data-supplement-note>
                          Invoice #{flow.currentInvoice.number} is issued.
                          Publishing now sends a <strong>supplement</strong>:
                          add the extra work to the job sheet and leave billed
                          lines as they are. Once the customer approves, “Bill
                          extra work” issues an add-on invoice for just the new
                          work.
                        </p>
                      )}
                      {s.actor.type !== "support" &&
                        true &&
                        !selected.documentOnly && (
                          <EstimatePublisher
                            taxRateBps={
                              flow?.currentInvoice
                                ? flow.currentInvoice.snapshot.taxBps
                                : data.profile?.taxRateBps
                            }
                            jobId={selected.id}
                            version={selected.version}
                            existingVersion={flow?.latest?.estimate.version}
                            pendingChanges={flow?.changedSinceEstimate}
                          />
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
          <div
            className="view-toggle record-view-controls"
            role="group"
            aria-label="Show jobs as"
          >
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
          {data.pipeline && data.techs.length > 0 && !techOnly && (
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
                const want = techOnly
                  ? techOnly
                  : tech === "me"
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
              <RecordSection
                title={auto ? "Find repair orders" : "Find jobs"}
                description="Search and filter the work below."
                className="record-page-tools"
              >
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
              </RecordSection>
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
                <div className="record-work-sections" aria-label="Jobs">
                  {groupWork(rows, (j) => statusOf(j.id))
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
                          {group.items.map((j) => {
                            const input = jobInput.parse(j.data);
                            const totals = calculateJob(
                              input.parts,
                              input.labor,
                            );
                            const flow = data.workflows.get(j.id);
                            const status = statusOf(j.id);
                            const approvedEstimate = flow?.latest?.estimate;
                            const awaiting = status === "sent";
                            const needsAppointment =
                              status === "won" &&
                              !flow?.repeats &&
                              !!approvedEstimate;
                            const nextAction = !canFollowUp
                              ? undefined
                              : awaiting
                                ? {
                                    label: "Follow up",
                                    href: followUpPath(j.id),
                                  }
                                : needsAppointment
                                  ? {
                                      label: "Book",
                                      href: `/app/schedule?${new URLSearchParams(
                                        {
                                          new: "1",
                                          customerId:
                                            approvedEstimate.customerId,
                                          ...(approvedEstimate.vehicleId
                                            ? {
                                                vehicleId:
                                                  approvedEstimate.vehicleId,
                                              }
                                            : {}),
                                          ...(approvedEstimate.serviceAssetId
                                            ? {
                                                serviceAssetId:
                                                  approvedEstimate.serviceAssetId,
                                              }
                                            : {}),
                                        },
                                      )}`,
                                    }
                                  : undefined;
                            const waitingDays = flow?.estimateSharedAt
                              ? Math.max(
                                  0,
                                  Math.floor(
                                    (Date.now() -
                                      flow.estimateSharedAt.getTime()) /
                                      86400000,
                                  ),
                                )
                              : null;
                            const owed =
                              flow?.currentInvoice && flow.balanceCents > 0
                                ? flow.balanceCents
                                : 0;
                            const customerName = data.options.customers.find(
                              (c) => c.id === input.customerId,
                            )?.name;
                            return (
                              <li key={j.id}>
                                <WorkCard
                                  href={`/app/jobs?job=${j.id}`}
                                  reference={jobReference(j.id, auto)}
                                  title={`${input.repeat ? "↻ " : ""}${j.title}`}
                                  customer={customerName}
                                  detail={
                                    awaiting && waitingDays !== null
                                      ? `Waiting for approval · ${waitingDays === 0 ? "today" : `${waitingDays} day${waitingDays === 1 ? "" : "s"}`}`
                                      : needsAppointment
                                        ? "Needs an appointment"
                                        : `Opened ${j.createdAt.toLocaleDateString("en-US", { timeZone: data.profile?.timezone || "America/Chicago", month: "short", day: "numeric" })}`
                                  }
                                  status={statusLabels[status]}
                                  statusClass={statusTone(status)}
                                  amount={money(owed || totals.subtotalCents)}
                                  amountLabel={
                                    owed ? "Balance due" : "Estimate"
                                  }
                                  ariaLabel={`Open job: ${j.title} · ${statusLabels[status]}`}
                                  nextAction={nextAction}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      </RecordSection>
                    ))}
                </div>
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
