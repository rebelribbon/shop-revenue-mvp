import { HydratedMain } from "@/components/hydrated-main";
import { listCommonJobs } from "@/domain/common-jobs";
import { loadJobWorkflows, stageLabels } from "@/domain/job-workflow";
import { JobWorkflow, WorkflowBadges } from "@/components/job-workflow";
import { isAutomotive, workspaceLabels } from "@/lib/business-types";
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
    customerId?: string;
    vehicleId?: string;
    serviceAssetId?: string;
    sourceRecoveryItemId?: string;
    sourceContactActivityId?: string;
    sourceAppointmentId?: string;
  }>;
}) {
  const {
    edit,
    job,
    new: creating,
    saved,
    q,
    stage,
    customerId,
    vehicleId,
    serviceAssetId,
    sourceRecoveryItemId,
    sourceContactActivityId,
    sourceAppointmentId,
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
    return {
      ...page,
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
  const rows = data.jobs.filter(
    (j) => !stage || data.workflows.get(j.id)?.stage === stage,
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
          title: "",
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
          />
        </>
      ) : selected ? (
        (() => {
          const input = jobInput.parse(selected.data),
            t = calculateJob(input.parts, input.labor);
          return (
            <>
              <p>
                <Link href="/app/jobs">← All jobs</Link>
              </p>
              {saved === "1" && (
                <p role="status" className="notice ok">
                  Job saved.
                </p>
              )}
              <article className="card">
                <h2>{selected.title}</h2>
                <p>
                  {
                    data.options.customers.find(
                      (c) => c.id === input.customerId,
                    )?.name
                  }
                </p>
                {flow && (
                  <JobWorkflow
                    flow={flow}
                    jobId={selected.id}
                    timezone={data.profile?.timezone || "America/Chicago"}
                    readOnly={s.actor.type === "support"}
                  />
                )}
                <details>
                  <summary>Change job or view costs</summary>
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
                    {money(t.estimatedGrossProfitCents)}
                  </p>
                </details>
                <details>
                  <summary>View parts, labor and costs</summary>
                  <ul>
                    {input.parts.map((part, i) => (
                      <li key={i}>
                        {part.description} — {part.quantity} ×{" "}
                        {money(part.unitPriceCents)} (unit cost{" "}
                        {money(part.unitCostCents)})
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
                </details>
                <section className="record-details" id="job-estimate">
                  <h3>Customer estimate</h3>
                  {!flow?.currentInvoice && s.actor.type !== "support" ? (
                    <EstimatePublisher
                      taxRateBps={data.profile?.taxRateBps}
                      jobId={selected.id}
                      version={selected.version}
                      existingVersion={flow?.latest?.estimate.version}
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
            <label htmlFor="job-stage">Workflow stage</label>
            <select id="job-stage" name="stage" defaultValue={stage ?? ""}>
              <option value="">All stages</option>
              {Object.entries(stageLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </form>
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
                    aria-label={`Open job: ${j.title} · ${stageLabels[data.workflows.get(j.id)!.stage]}`}
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
                      <strong className="workflow-stage-label">
                        {stageLabels[data.workflows.get(j.id)!.stage]}
                      </strong>
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
