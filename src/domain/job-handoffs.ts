// Durable, recipient-addressed in-app handoffs on the existing tenant activity
// ledger. No push/SMS delivery is implied; the logged-in recipient sees a task.
import { and, desc, eq } from "drizzle-orm";
import { activity, jobAssignment } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { currentMemberRole } from "./membership";
import { recordActivity } from "./records";

export type JobHandoffStage = "inspect_vehicle" | "build_estimate";
type HandoffData = {
  stage: JobHandoffStage;
  recipientUserId: string;
  advisorUserId: string;
  technicianUserId: string;
};
export type JobHandoff = HandoffData & {
  jobId: string;
  title: string;
  occurredAt: Date;
};

function handoffData(value: unknown): HandoffData | null {
  if (!value || typeof value !== "object") return null;
  const d=value as Partial<HandoffData>;
  if ((d.stage!=="inspect_vehicle" && d.stage!=="build_estimate") ||
      typeof d.recipientUserId!=="string" ||
      typeof d.advisorUserId!=="string" ||
      typeof d.technicianUserId!=="string") return null;
  return d as HandoffData;
}

// Called in the SAME tenant transaction as the assignment update.
export async function notifyTechnicianAssigned(
  tx: TenantTx, jobId:string, technicianUserId:string, advisorUserId:string,
) {
  await recordActivity(tx,{
    kind:"job.handoff",
    subjectType:"job",subjectId:jobId,
    summary:"Technician assigned: pick up vehicle and complete diagnosis and inspection",
    data:{
      stage:"inspect_vehicle",
      recipientUserId:technicianUserId,technicianUserId,advisorUserId,
    } satisfies HandoffData,
  });
}

// Called once when a previously incomplete checklist becomes complete.
// Resolves the assigned advisor from the current assignment handoff, never
// from arbitrary client-supplied IDs or a technician's text field.
export async function notifyAdvisorInspectionComplete(tx:TenantTx,jobId:string) {
  const [assignment]=await tx.select({userId:jobAssignment.userId})
    .from(jobAssignment).where(and(eq(jobAssignment.businessId,tx.businessId),
      eq(jobAssignment.jobId,jobId))).limit(1);
  if(!assignment?.userId) return;
  const history=await tx.select({data:activity.data}).from(activity)
    .where(and(eq(activity.businessId,tx.businessId),
      eq(activity.subjectType,"job"),eq(activity.subjectId,jobId),
      eq(activity.kind,"job.handoff")))
    .orderBy(desc(activity.occurredAt),desc(activity.id)).limit(30);
  const assignmentEvent=history.map(e=>handoffData(e.data))
    .find(e=>e?.stage==="inspect_vehicle" && e.technicianUserId===assignment.userId);
  if(!assignmentEvent) return;
  await recordActivity(tx,{
    kind:"job.handoff",subjectType:"job",subjectId:jobId,
    summary:"Inspection completed: advisor to build and send estimate",
    data:{
      ...assignmentEvent,
      stage:"build_estimate",
      recipientUserId:assignmentEvent.advisorUserId,
    } satisfies HandoffData,
  });
}

export async function listMyJobHandoffs(tx:TenantTx):Promise<JobHandoff[]> {
  const id=tx.actor.type==="user"?tx.actor.id:null;
  if(!id) return [];
  const role=await currentMemberRole(tx);
  if(!role)return [];
  const rows=await tx.select({
    jobId:activity.subjectId,title:activity.summary,
    data:activity.data,occurredAt:activity.occurredAt,
  }).from(activity).where(and(eq(activity.businessId,tx.businessId),
    eq(activity.kind,"job.handoff"),eq(activity.subjectType,"job")))
    .orderBy(desc(activity.occurredAt),desc(activity.id)).limit(1000);
  // Only the latest handoff per RO remains actionable. Earlier/reassigned
  // recipients cannot continue to see obsolete assignments.
  const latest=new Map<string,(typeof rows)[number]>();
  for(const row of rows)if(!latest.has(row.jobId))latest.set(row.jobId,row);
  const output:JobHandoff[]=[];
  for(const row of latest.values()){
    const data=handoffData(row.data);
    if(!data || data.recipientUserId!==id)continue;
    if(role==="technician" && data.stage!=="inspect_vehicle")continue;
    if(role!=="technician" && data.stage!=="build_estimate")continue;
    if(data.stage==="inspect_vehicle"){
      const [assigned]=await tx.select({userId:jobAssignment.userId})
        .from(jobAssignment).where(and(eq(jobAssignment.businessId,tx.businessId),
          eq(jobAssignment.jobId,row.jobId))).limit(1);
      if(assigned?.userId!==id)continue;
    }
    output.push({...data,jobId:row.jobId,title:row.title,occurredAt:row.occurredAt});
  }
  return output;
}

export async function assertAssignedTechnician(tx:TenantTx,jobId:string) {
  if(tx.actor.type!=="user" || !tx.actor.id)throw new AppError("FORBIDDEN","Sign in to work on this job.");
  const [assigned]=await tx.select({userId:jobAssignment.userId})
    .from(jobAssignment).where(and(eq(jobAssignment.businessId,tx.businessId),
      eq(jobAssignment.jobId,jobId))).limit(1);
  if(assigned?.userId!==tx.actor.id)
    throw new AppError("FORBIDDEN","This repair order is not assigned to you.");
}
