import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { customer, legalPolicy, vehicle } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getJob, listJobs, jobInput } from "@/domain/jobs";
import { listTasks } from "@/domain/tasks";
import { listVisitsRange } from "@/domain/appointments";
import { listTechs, listAdvisors, jobAssignees } from "@/domain/assignments";
import { getBusinessProfile } from "@/domain/business-profile";
import { canManageTeam, listTeam } from "@/domain/membership";
import { loadJobWorkflows } from "@/domain/job-workflow";
import { getInspection } from "@/domain/inspections";
import { getTechnicianRepairs } from "@/domain/technician-repairs";
import { activity } from "@/db/schema";
import { listMedia } from "@/domain/job-media";
import { isAutomotive } from "@/lib/business-types";
import { jobReference } from "@/lib/job-reference";
import { requireShopSession } from "@/server/views/shop";
import { getStripeConnection } from "@/domain/payments";
import { shopPaymentSetup } from "@/lib/shop-payment-setup";
import {
  getShopSubscription,
  getSubscriptionPricing,
  refreshShopSubscription,
} from "@/domain/billing";
import { billingAccess, canMakeChanges } from "@/lib/billing";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const localDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const localTime = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
const moneyDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

function stageFor(
  stage: string,
  inspectionFirst: boolean,
  inspectionCompleted: boolean,
) {
  if (stage === "draft")
    return inspectionFirst && !inspectionCompleted ? "inspection" : "estimate";
  if (stage === "awaiting") return "approval";
  if (stage === "ready" || stage === "working") return "repair";
  if (stage === "bill") return "invoice";
  if (stage === "payment" || stage === "attention" || stage === "paid")
    return "payment";
  if (stage === "declined" || stage === "plan_ended") return "closed";
  return "estimate";
}
const serialize = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const selectedRoId = params.get("ro");
  const billingView = params.get("view") === "billing";
  const session = await requireShopSession(
    billingView ? "/automotive?view=billing" : "/automotive",
  );
  if (billingView && session.role !== "owner")
    redirect("/automotive?view=settings");
  if (billingView && session.actor.type === "user")
    await refreshShopSubscription(session.businessId).catch(() =>
      logger.warn({ event: "billing.refresh_failed" }),
    );
  const actorId = session.actor.type === "user" ? session.actor.id : null;
  const result = await withTenant(
    session.businessId,
    session.actor,
    async (tx) => {
      const profile = await getBusinessProfile(tx);
      if (!isAutomotive(profile?.businessType ?? "automotive")) return null;
      const [approvedAuthorization] = await tx
        .select({ id: legalPolicy.id, body: legalPolicy.body })
        .from(legalPolicy)
        .where(
          and(
            eq(legalPolicy.kind, "estimate_authorization"),
            eq(
              legalPolicy.jurisdictionCode,
              profile?.jurisdictionCode ?? "US-TX",
            ),
            eq(legalPolicy.status, "approved"),
          ),
        )
        .limit(1);
      const subscription = await getShopSubscription(tx);
      const access = billingAccess(subscription, new Date());
      const billingSetup = {
        kind: access.kind,
        blocked: !canMakeChanges(access),
        trialUsed: session.role === "owner" && !!subscription?.trialUsedAt,
        trialEndsAt:
          session.role === "owner" && access.kind === "full"
            ? (access.trialEndsAt?.toISOString() ?? null)
            : null,
      };
      const billingDetail =
        billingView && session.role === "owner"
          ? {
              ...billingSetup,
              canAct: session.actor.type === "user",
              pricing: await getSubscriptionPricing(
                subscription?.stripeSubscriptionId ?? undefined,
              ),
              cancelAt:
                access.kind === "full"
                  ? (access.cancelAt?.toISOString() ?? null)
                  : null,
              currentPeriodEnd:
                subscription?.currentPeriodEnd?.toISOString() ?? null,
              lockAt:
                access.kind === "grace" ? access.lockAt.toISOString() : null,
              paymentFailed:
                access.kind === "locked" && access.reason === "payment_failed",
            }
          : null;
      const paymentSetup =
        session.role === "owner"
          ? shopPaymentSetup(
              await getStripeConnection(tx),
              session.actor.type !== "user",
            )
          : null;
      const technician = session.role === "technician";
      const management = session.role === "owner" || (await canManageTeam(tx));
      const [recentJobs, taskRows, technicians, advisors, teamRows] =
        await Promise.all([
          listJobs(tx),
          listTasks(tx),
          listTechs(tx),
          listAdvisors(tx),
          management ? listTeam(tx) : Promise.resolve([]),
        ]);
      const selectedRo =
        selectedRoId && !recentJobs.some((job) => job.id === selectedRoId)
          ? await getJob(tx, selectedRoId)
          : null;
      const jobs = selectedRo ? [selectedRo, ...recentJobs] : recentJobs;
      const jobIds = jobs.map((j) => j.id);
      const [flows, techMap, mediaRows, repairRows, releasedRows] =
        await Promise.all([
          loadJobWorkflows(tx, jobIds),
          jobAssignees(tx, jobIds),
          listMedia(tx, {}),
          getTechnicianRepairs(tx, jobIds),
          jobIds.length
            ? tx
                .select({ id: activity.subjectId })
                .from(activity)
                .where(
                  and(
                    eq(activity.businessId, tx.businessId),
                    eq(activity.kind, "ro.released"),
                    inArray(activity.subjectId, jobIds),
                  ),
                )
            : Promise.resolve([]),
        ]);
      const releasedIds = new Set(releasedRows.map((entry) => entry.id));
      const documentEvents =
        !technician && jobIds.length
          ? await tx
              .select({
                kind: activity.kind,
                documentId: sql<string>`coalesce(${activity.data}->>'documentId', ${activity.data}->>'versionId')`,
                at: activity.occurredAt,
              })
              .from(activity)
              .where(
                and(
                  eq(activity.businessId, tx.businessId),
                  inArray(activity.kind, [
                    "document.email_submitted",
                    "estimate.customer_opened",
                  ]),
                  inArray(sql<string>`${activity.data}->>'jobId'`, jobIds),
                ),
              )
              .orderBy(activity.occurredAt)
          : [];
      const documentEventTime = new Map(
        documentEvents.map(({ kind, documentId, at }) => [
          `${kind}:${documentId}`,
          at,
        ]),
      );
      const parsed = jobs
        .map((j) => ({ row: j, input: jobInput.safeParse(j.data) }))
        .filter((j) => j.input.success);
      const assignedCustomers = [
        ...new Set(
          parsed
            .map((j) => j.input.data?.customerId)
            .filter((id): id is string => !!id),
        ),
      ];
      const customers =
        technician && !assignedCustomers.length
          ? []
          : await tx
              .select({
                id: customer.id,
                name: customer.displayName,
                phone: customer.phoneE164,
                email: customer.email,
                address: customer.addressLine1,
                city: customer.city,
                region: customer.region,
                notes: customer.notes,
                advisor: customer.assignedUserId,
                created: customer.createdAt,
              })
              .from(customer)
              .where(
                and(
                  eq(customer.businessId, session.businessId),
                  eq(customer.status, "active"),
                  technician
                    ? inArray(customer.id, assignedCustomers)
                    : management
                      ? undefined
                      : actorId
                        ? or(
                            eq(customer.assignedUserId, actorId),
                            assignedCustomers.length
                              ? inArray(customer.id, assignedCustomers)
                              : undefined,
                          )
                        : undefined,
                ),
              )
              .orderBy(desc(customer.updatedAt))
              .limit(300);
      const allowedIds = customers.map((c) => c.id);
      const vehicles = !allowedIds.length
        ? []
        : await tx
            .select({
              id: vehicle.id,
              customer: vehicle.customerId,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              vin: vehicle.vin,
              plate: vehicle.plate,
              mileage: vehicle.mileage,
            })
            .from(vehicle)
            .where(
              and(
                eq(vehicle.businessId, session.businessId),
                eq(vehicle.status, "active"),
                inArray(vehicle.customerId, allowedIds),
              ),
            )
            .limit(600);
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      const end = new Date(now);
      end.setDate(end.getDate() + 90);
      const visits = technician
        ? { rows: [] }
        : await listVisitsRange(tx, localDay(start), localDay(end));
      const inspections = await Promise.all(
        parsed
          .slice(0, 75)
          .map(
            async ({ row }) =>
              [row.id, await getInspection(tx, row.id)] as const,
          ),
      );
      const inspectionsById = new Map(inspections);
      const nameOf = (id: string) =>
        customers.find((c) => c.id === id)?.name ??
        flows.get(
          parsed.find((j) => j.input.data?.customerId === id)?.row.id ?? "",
        )?.latest?.estimate.snapshot.customerName ??
        "Customer";
      const ros = parsed
        .map(({ row, input }) => {
          if (!input.success) return null;
          const j = input.data,
            flow = flows.get(row.id);
          const latest = flow?.latest?.estimate;
          const auth = flow?.latest?.authorization;
          const inspection = inspectionsById.get(row.id);
          const assessment = inspection?.assessment ?? {
            diagnosis: "",
            bay: "",
            vehiclePickedUp: false,
          };
          let diagnosis: Record<string, string | boolean> = {};
          if (assessment.diagnosis) {
            try {
              const parsedDiagnosis: unknown = JSON.parse(assessment.diagnosis);
              if (
                parsedDiagnosis &&
                typeof parsedDiagnosis === "object" &&
                !Array.isArray(parsedDiagnosis)
              )
                diagnosis = parsedDiagnosis as Record<string, string | boolean>;
            } catch {
              diagnosis = { cause: assessment.diagnosis };
            }
          }
          const checklist = inspection?.items ?? [];
          const repair = repairRows.get(row.id);
          const checks = Object.fromEntries(
            checklist.map((item) => [
              item.key,
              {
                result:
                  item.status === "good"
                    ? "good"
                    : item.status === "na"
                      ? "na"
                      : item.status === "unchecked"
                        ? null
                        : "attention",
                note: item.note,
              },
            ]),
          );
          const media = mediaRows
            .filter((m) => m.jobId === row.id)
            .map((m) => ({
              id: m.id,
              kind: m.mediaType === "video" ? "video" : "photo",
              category:
                m.mediaType === "video"
                  ? "customer"
                  : m.tag === "after"
                    ? "repair"
                    : "diagnosis",
              checkId: "",
              name:
                m.caption ??
                (m.mediaType === "video"
                  ? "Customer video"
                  : "Inspection photo"),
              caption: m.caption ?? "",
              public: m.showCustomer,
              fileUrl:
                "/automotive/media?fileId=" + encodeURIComponent(m.fileId),
              dataUrl:
                "/automotive/media?fileId=" + encodeURIComponent(m.fileId),
            }));
          const liveStage = stageFor(
            flow?.stage ?? "draft",
            !!j.inspectionFirst,
            !!inspection?.complete,
          );
          const stage = releasedIds.has(row.id) ? "closed" : liveStage;
          const approved = new Set(auth?.approvedLineIds ?? []);
          // Pricing must show the CURRENT draft, not only already-frozen
          // customer estimates. Parts and labor belonging to one named
          // recommendation appear as a single priced decision.
          const draftNames = [
            ...new Set([
              ...j.parts.map((p) => p.description),
              ...j.labor.map((l) => l.description),
            ]),
          ];
          const draftLines = draftNames.map((name, index) => ({
            id: `draft-${index}`,
            name,
            parts: j.parts
              .filter((p) => p.description === name)
              .reduce((n, p) => n + (p.quantity * p.unitPriceCents) / 100, 0),
            labor: j.labor
              .filter((l) => l.description === name)
              .reduce(
                (n, l) =>
                  n + (l.estimatedHoursHundredths * l.sellRateCents) / 10000,
                0,
              ),
            cost:
              j.parts
                .filter((p) => p.description === name)
                .reduce(
                  (n, p) => n + (p.quantity * (p.unitCostCents ?? 0)) / 100,
                  0,
                ) +
              j.labor
                .filter((l) => l.description === name)
                .reduce(
                  (n, l) =>
                    n +
                    (l.estimatedHoursHundredths * (l.costRateCents ?? 0)) /
                      10000,
                  0,
                ),
            recommended: [...j.parts, ...j.labor].some(
              (line) =>
                line.description === name &&
                (line.fromInspection === true ||
                  !!line.recommendationId ||
                  !!line.recommendationSource),
            ),
            recommendationSource:
              [...j.parts, ...j.labor].find(
                (line) =>
                  line.description === name && !!line.recommendationSource,
              )?.recommendationSource ??
              ([...j.parts, ...j.labor].some(
                (line) => line.description === name && line.fromInspection,
              )
                ? "inspection"
                : [...j.parts, ...j.labor].some(
                      (line) =>
                        line.description === name && !!line.recommendationId,
                    )
                  ? "prior"
                  : null),
            inspectionItemKey:
              [...j.parts, ...j.labor].find(
                (line) => line.description === name && !!line.inspectionItemKey,
              )?.inspectionItemKey ?? null,
            originLocked: [...j.parts, ...j.labor].some(
              (line) =>
                line.description === name &&
                (!!line.recommendationId || !!line.inspectionItemKey),
            ),
            decision: null,
          }));
          const lines = technician
            ? []
            : latest
              ? latest.snapshot.lines.map((l) => ({
                  id: l.id,
                  name: l.description,
                  parts:
                    l.kind === "part"
                      ? (l.quantity * l.unitPriceCents) / 100
                      : 0,
                  labor:
                    l.kind === "labor"
                      ? (l.quantity * l.unitPriceCents) / 100
                      : 0,
                  recommended: l.recommended === true,
                  recommendationSource:
                    l.recommendationSource ?? (l.recommended ? "prior" : null),
                  inspectionItemKey: l.inspectionItemKey ?? null,
                  originLocked:
                    l.recommendationSource === "inspection" ||
                    l.recommendationSource === "prior",
                  cost: 0,
                  decision: auth
                    ? approved.has(l.id)
                      ? "approved"
                      : "declined"
                    : null,
                }))
              : draftLines;
          return {
            id: row.id,
            version: row.version,
            num: jobReference(row.id, true),
            customer: j.customerId,
            vehicle: j.vehicleId ?? null,
            advisor:
              j.advisorUserId ??
              customers.find((c) => c.id === j.customerId)?.advisor ??
              null,
            tech: techMap.get(row.id) ?? null,
            concern: j.concerns || row.title,
            mileage: j.mileageIn ?? 0,
            stage,
            inspection: (inspection?.items ?? [])
              .filter((i) => i.status !== "unchecked")
              .map((i) => ({
                name: i.label,
                result:
                  i.status === "good"
                    ? "good"
                    : i.status === "na"
                      ? "good"
                      : "attention",
                note: i.note || i.recommendedWork || "",
              })),
            lines,
            media,
            inspectionItems: checklist,
            inspectionAssessment: assessment,
            authorizationRecords: technician
              ? []
              : (flow?.estimates ?? []).map(({ estimate, authorization }) => ({
                  id: estimate.id,
                  version: estimate.version,
                  created: moneyDate(estimate.createdAt),
                  signed: !!authorization,
                  signedBy: authorization?.signerName ?? null,
                  signedAt: moneyDate(authorization?.createdAt),
                  approvedCount: authorization?.approvedLineIds.length ?? 0,
                  lineCount: estimate.snapshot.lines.length,
                  revoked: !!estimate.revokedAt,
                })),
            mediaPreviewRequired: true,
            techData: {
              media,
              checks,
              repair: repair?.lines ?? {},
              qualityCheck: repair?.qualityCheck ?? false,
              postRepairNotes: repair?.postRepairNotes ?? "",
              diagnosis: {
                ...diagnosis,
                bay: assessment.bay,
                vehiclePickedUp: assessment.vehiclePickedUp,
                saved: !!assessment.diagnosis,
              },
            },
            estimateId: latest?.id ?? null,
            estimateVersion: latest?.version ?? 0,
            estimateSent: moneyDate(
              flow?.estimateSharedAt ??
                documentEventTime.get(`document.email_submitted:${latest?.id}`),
            ),
            estimateOpened: moneyDate(
              documentEventTime.get(`estimate.customer_opened:${latest?.id}`),
            ),
            authorized: moneyDate(auth?.createdAt),
            signedBy: technician ? null : (auth?.signerName ?? null),
            released: releasedIds.has(row.id),
            workDone: flow?.work === "completed",
            workStatus: flow?.work ?? "not_recorded",
            invoiceId: flow?.currentInvoice?.id ?? null,
            invoiceNumber: flow?.currentInvoice?.number ?? null,
            invoiceEmailSubmitted: moneyDate(
              documentEventTime.get(
                `document.email_submitted:${flow?.currentInvoice?.id}`,
              ),
            ),
            invoiceShared:
              (flow?.sharedInvoice ?? false) ||
              documentEventTime.has(
                `document.email_submitted:${flow?.currentInvoice?.id}`,
              ),
            invoiceBalanceCents: flow?.balanceCents ?? 0,
            invoiceTotalCents: flow?.currentInvoice?.totalCents ?? 0,
            paymentRows: technician
              ? []
              : (flow?.entries ?? []).map((payment) => ({
                  id: payment.id,
                  at: moneyDate(payment.createdAt),
                  amountCents: payment.amountCents,
                  method: payment.method,
                  reference: payment.reference,
                })),
            invoiceSent: moneyDate(flow?.currentInvoice?.createdAt),
            paid: flow?.stage === "paid",
            amountPaid: technician ? 0 : (flow?.paidCents ?? 0) / 100,
            created: row.createdAt.toISOString(),
            history: technician
              ? []
              : (flow?.timeline ?? [])
                  .slice(-30)
                  .reverse()
                  .map((h) => ({
                    at: moneyDate(h.at) ?? "",
                    by: "System",
                    text: h.text,
                  })),
            // Real documents are handled by the existing authenticated RO flow.
            liveHref: "/app/jobs?job=" + row.id,
            customerName: nameOf(j.customerId),
          };
        })
        .filter((r) => r !== null);
      const team = new Map<
        string,
        { id: string; name: string; role: string; active: boolean }
      >();
      for (const a of advisors)
        team.set(a.userId, {
          id: a.userId,
          name: a.name,
          role: "advisor",
          active: true,
        });
      for (const a of technicians)
        if (!team.has(a.userId))
          team.set(a.userId, {
            id: a.userId,
            name: a.name,
            role: "technician",
            active: true,
          });
      const role =
        session.role === "owner"
          ? "owner"
          : technician
            ? "technician"
            : management
              ? "manager"
              : "advisor";
      const self = actorId ?? "support-view";
      team.set(self, {
        id: self,
        name: team.get(self)?.name ?? "My account",
        role,
        active: true,
      });
      const appointments = visits.rows.map((v) => ({
        id: v.id,
        customer: v.customerId,
        vehicle: v.vehicleId,
        date: localDay(v.startsAt),
        time: localTime(v.startsAt),
        purpose: v.reason || "Service appointment",
        advisor: v.assignedUserId ?? self,
        status: v.status === "scheduled" ? "Scheduled" : v.status,
        created: v.startsAt.toISOString(),
      }));
      const tasks = [...taskRows.due, ...taskRows.later].map((item) => ({
        id: item.key,
        title: item.title,
        type: "workflow",
        role:
          technician ||
          item.title.toLowerCase().includes("technician") ||
          item.title.toLowerCase().includes("authorized work")
            ? "technician"
            : "advisor",
        who: self,
        ro: item.jobId ?? null,
        customer: item.customerId,
        step: item.jobId
          ? item.title.toLowerCase().includes("inspect") ||
            item.title.toLowerCase().includes("diagnos")
            ? "diagnosis"
            : item.title.toLowerCase().includes("repair") ||
                item.title.toLowerCase().includes("authorized work")
              ? "work"
              : item.title.toLowerCase().includes("invoice")
                ? "invoice"
                : item.title.toLowerCase().includes("estimate")
                  ? "estimate"
                  : "overview"
          : undefined,
        status: "open",
        detail: item.detail ?? item.title,
        due: item.dueOn,
        liveHref: item.jobId
          ? "/automotive?ro=" + encodeURIComponent(item.jobId)
          : item.customerId
            ? "/automotive?customer=" + encodeURIComponent(item.customerId)
            : "/automotive?view=tasks",
      }));
      const metrics = {
        active: ros.filter((r) => r.stage !== "closed").length,
        outstandingCents: technician
          ? 0
          : [...flows.values()].reduce(
              (n, f) => n + Math.max(0, f.balanceCents ?? 0),
              0,
            ),
        paidCents: technician
          ? 0
          : [...flows.values()].reduce((n, f) => n + (f.paidCents ?? 0), 0),
      };
      return {
        uid: 0,
        actor: self,
        business: profile?.dba || profile?.legalName || "Automotive repair",
        businessType: "automotive",
        isLive: true,
        authorizationPolicyReady: !!approvedAuthorization,
        authorizationPolicyBody: approvedAuthorization?.body ?? null,
        paymentSetup,
        billingSetup,
        billingDetail,
        settings: {
          tax: (profile?.taxRateBps ?? 0) / 100,
          legalName: profile?.legalName ?? "",
          dba: profile?.dba ?? "",
          addressLine1: profile?.addressLine1 ?? "",
          city: profile?.city ?? "",
          region: profile?.region ?? "",
          postalCode: profile?.postalCode ?? "",
          timezone: profile?.timezone ?? "America/Chicago",
          laborSellRate: (profile?.laborSellRateCents ?? 0) / 100,
          laborCostRate: (profile?.laborCostRateCents ?? 0) / 100,
          address: [profile?.addressLine1, profile?.city, profile?.region]
            .filter(Boolean)
            .join(", "),
          phone: profile?.phoneE164 ?? "",
          email: "",
          currency: "USD",
        },
        staff: [...team.values()],
        teamMembers: teamRows.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.displayName || m.inviteName || "Team member",
          email: m.email || m.inviteEmail || "",
          phone: m.phoneE164 || m.invitePhoneE164 || "",
          role:
            m.role === "owner"
              ? "owner"
              : m.role === "technician"
                ? "technician"
                : m.canManageTeam
                  ? "manager"
                  : "advisor",
          status: m.status,
        })),
        customers: customers.map((c) => ({
          id: c.id,
          name: c.name,
          phone: technician ? "" : (c.phone ?? ""),
          email: technician ? "" : (c.email ?? ""),
          address: technician
            ? ""
            : [c.address, c.city, c.region].filter(Boolean).join(", "),
          advisor: c.advisor ?? self,
          notes: technician ? "" : (c.notes ?? ""),
          created: c.created?.toISOString() ?? "",
        })),
        vehicles,
        ros,
        appointments,
        tasks,
        audit: [],
        metrics,
        currentRole: role,
        manager: management,
        technician,
        shopBusinessId: session.businessId,
      };
    },
  );
  if (!result) redirect("/app");
  const source = await readFile(
    join(process.cwd(), "docs/approved-designs/automotive-unified.html"),
    "utf8",
  );
  const bridge = await readFile(
    join(process.cwd(), "src/app/automotive/live-bridge.js"),
    "utf8",
  );
  const billingStyles = await readFile(
    join(process.cwd(), "src/app/automotive/billing.css"),
    "utf8",
  );
  const start = source.indexOf("const makeSeed=()=>");
  const uiStart = source.indexOf("let ui=", start);
  if (start < 0 || uiStart < 0)
    return new Response("Automotive design file is invalid.", { status: 500 });
  let live =
    source.slice(0, start) +
    "let data=" +
    serialize(result) +
    ";" +
    source.slice(uiStart);
  const demoSave =
    "const save=()=>{syncWorkflowTasks();try{localStorage.setItem(KEY,JSON.stringify(data))}catch{}};";
  if (!live.includes(demoSave))
    return new Response("Automotive design data adapter is outdated.", {
      status: 500,
    });
  live = live.replace(demoSave, "const save=()=>{};");
  live = live.replace(
    "window.addEventListener('storage',e=>{if(e.key===KEY){try{data=JSON.parse(e.newValue)||data;render()}catch{}}});",
    "",
  );

  live = live.replace(
    "const DAY='2026-11-18';",
    "const DAY=new Date().toISOString().slice(0,10);",
  );
  live = live.replace(
    "calendarMonth:10,calendarYear:2026",
    "calendarMonth:new Date().getMonth(),calendarYear:new Date().getFullYear()",
  );
  const lastRender = live.lastIndexOf("save();render();");
  if (lastRender < 0)
    return new Response("Automotive design boot code is invalid.", {
      status: 500,
    });
  live =
    live.slice(0, lastRender) +
    bridge +
    "\nrender();" +
    live.slice(lastRender + "save();render();".length);
  live = live.replaceAll(
    "INTERACTIVE DESIGN PROTOTYPE · LOCAL ONLY",
    "LIVE AUTOMOTIVE WORKSPACE",
  );
  live = live.replaceAll(
    "↗ Try customer approval link",
    "Customer authorization records",
  );
  live = live.replace("</head>", `<style>${billingStyles}</style></head>`);
  // Keep the approved appearance while removing the prototype-only UI and role simulation.
  return new Response(live, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}
