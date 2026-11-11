// Email pings for RO handoffs. The in-app inbox only helps someone who has
// the app open; this reaches the technician when they're assigned and the
// advisor when the inspection is submitted. The message is built inside the
// action's transaction and sent after it commits. It carries the RO
// reference and job title only: no customer contact details or prices.
import { and, desc, eq, sql } from "drizzle-orm";
import { activity, business, membership, user } from "@/db/schema";
import { runInContext, withTenant, type TenantTx } from "@/db/tenant";
import { hashToken } from "@/lib/tokens";
import { notifyTechnicianWorkApproved } from "./job-handoffs";
import { loadJobWorkflows } from "./job-workflow";
import { safeErrorDiagnostic } from "@/lib/errors";
import { isAutomotive } from "@/lib/business-types";
import { jobReference } from "@/lib/job-reference";
import { logger } from "@/lib/logger";
import { emailProvider, type OutboundEmail } from "@/providers/email";
import {
  ADVISOR_STAGES,
  TECHNICIAN_STAGES,
  type JobHandoffStage,
} from "./job-handoffs";
import { getJob } from "./jobs";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";

export type PreparedHandoffPing = {
  jobId: string;
  stage: JobHandoffStage;
  email: OutboundEmail;
};

async function member(tx: TenantTx, userId: string) {
  const [row] = await tx
    .select({ email: user.email, name: user.displayName })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        eq(membership.userId, userId),
        eq(membership.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

const first = (name: string | null | undefined) =>
  name?.trim().split(/\s+/)[0] || "there";

export async function handoffPingsOn(tx: TenantTx) {
  const [shop] = await tx
    .select({ on: business.handoffEmailPings })
    .from(business)
    .where(eq(business.id, tx.businessId));
  return shop?.on ?? true;
}

export async function setHandoffPings(
  tx: TenantTx,
  meta: RequestMeta,
  on: boolean,
) {
  await assertOwner(tx);
  await tx
    .update(business)
    .set({ handoffEmailPings: on })
    .where(eq(business.id, tx.businessId));
  await audit(tx, meta, {
    action: "handoff_pings.saved",
    targetType: "business",
    targetId: tx.businessId,
    after: { on },
  });
  return { on };
}

// Builds the email for the RO's newest handoff, or null when there's nobody
// to email: pings are off, the handoff is finished, the recipient has no
// email, or the recipient is the person who just did it.
export async function prepareHandoffPing(
  tx: TenantTx,
  jobId: string,
): Promise<PreparedHandoffPing | null> {
  const [shop] = await tx
    .select({
      on: business.handoffEmailPings,
      dba: business.dba,
      legalName: business.legalName,
      businessType: business.businessType,
    })
    .from(business)
    .where(eq(business.id, tx.businessId));
  if (!shop?.on) return null;
  const [latest] = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        eq(activity.subjectId, jobId),
        eq(activity.kind, "job.handoff"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  const data = latest?.data as
    | {
        stage?: string;
        recipientUserId?: string;
        advisorUserId?: string;
        technicianUserId?: string;
      }
    | undefined;
  const stage = [...TECHNICIAN_STAGES, ...ADVISOR_STAGES].find(
    (x) => x === data?.stage,
  );
  if (!data || !stage || typeof data.recipientUserId !== "string") return null;
  if (tx.actor.type === "user" && tx.actor.id === data.recipientUserId)
    return null;
  const to = await member(tx, data.recipientUserId);
  if (!to?.email) return null;
  const job = await getJob(tx, jobId);
  if (!job) return null;
  const toTechnician = TECHNICIAN_STAGES.includes(stage);
  const otherId = toTechnician ? data.advisorUserId : data.technicianUserId;
  const other = otherId ? await member(tx, otherId) : null;
  const shopName = shop.dba?.trim() || shop.legalName;
  const ref = jobReference(jobId, isAutomotive(shop.businessType));
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  const link = base ? `${base}/app/jobs?job=${jobId}` : null;
  const advisor = other?.name?.trim() || "The front office";
  const technician = other?.name?.trim() || "The technician";
  const text: Record<JobHandoffStage, { subject: string; body: string[] }> = {
    inspect_vehicle: {
      subject: `Assigned to you: ${ref} · ${job.title}`,
      body: [
        `${advisor} put you on ${ref}: ${job.title}.`,
        "",
        "Next: pick up the vehicle, diagnose it and complete the inspection. When you submit it, your advisor is told the estimate is ready to build.",
      ],
    },
    build_estimate: {
      subject: `Inspection done, build the estimate: ${ref} · ${job.title}`,
      body: [
        `${technician} finished the inspection on ${ref}: ${job.title}.`,
        "",
        "The estimate is waiting on you: review the findings and build it.",
      ],
    },
    perform_work: {
      subject: `Approved, start the work: ${ref} · ${job.title}`,
      body: [
        `The customer approved work on ${ref}: ${job.title}.`,
        "",
        "Next: open the RO for the approved list and do only what was authorized. Mark the work complete when you're done and your advisor is told to invoice.",
      ],
    },
    invoice_customer: {
      subject: `Work complete, invoice the customer: ${ref} · ${job.title}`,
      body: [
        `${technician} finished the authorized work on ${ref}: ${job.title}.`,
        "",
        "Next: send the invoice and payment link, then return the keys once it's paid.",
      ],
    },
  };
  return {
    jobId,
    stage,
    email: {
      to: to.email,
      subject: text[stage].subject,
      text: [
        `Hi ${first(to.name)},`,
        "",
        ...text[stage].body,
        "",
        link ? `Open it: ${link}` : "Open it from Tasks in the app.",
        "",
        shopName,
      ].join("\n"),
      fromName: shopName,
      metadata: { kind: "ro_handoff", stage, jobId },
    },
  };
}

// After commit. A failed email never undoes the handoff: the task is
// already in the recipient's inbox.
export async function sendHandoffPing(p: PreparedHandoffPing | null) {
  if (!p) return false;
  try {
    await emailProvider().send(p.email);
    return true;
  } catch (error) {
    logger.warn({
      event: "handoff_ping.failed",
      jobId: p.jobId,
      stage: p.stage,
      ...safeErrorDiagnostic(error),
    });
    return false;
  }
}

// Right after a customer signs: hand the approved work to the assigned
// technician and email them. Runs as the system, outside the signing
// transaction, so a problem here can never undo or block a signature.
export async function handOffApprovedWork(token: string) {
  const ref = await runInContext(
    null,
    { type: "customer", id: null },
    async (tx) => {
      const r = await tx.execute(
        sql`select business_id, quote_id from app.estimate_job_ref(${hashToken(token)})`,
      );
      return r.rows[0]
        ? {
            businessId: String(r.rows[0].business_id),
            jobId: String(r.rows[0].quote_id),
          }
        : null;
    },
  );
  if (!ref) return false;
  const ping = await withTenant(
    ref.businessId,
    { type: "system", id: null },
    async (tx) => {
      const flow = (await loadJobWorkflows(tx, [ref.jobId])).get(ref.jobId);
      if (!flow?.latest?.authorization || !flow.approved.length) return null;
      if (!(await notifyTechnicianWorkApproved(tx, ref.jobId))) return null;
      return prepareHandoffPing(tx, ref.jobId);
    },
    { role: "app" },
  );
  return sendHandoffPing(ping);
}
