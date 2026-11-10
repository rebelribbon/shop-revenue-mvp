import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob } from "@/domain/jobs";
import { assignAdvisor, assignJob, listAdvisors, listTechs } from "@/domain/assignments";
import { assertAssignedTechnician, listMyJobHandoffs } from "@/domain/job-handoffs";
import { getInspection, saveInspection } from "@/domain/inspections";
import { listTasks } from "@/domain/tasks";
import { inviteStaff, acceptInvite } from "@/domain/membership";
import { meta, seedTenant } from "../helpers/fixtures";

describe("RO recipient-specific handoff security", () => {
  it("notifies the assigned technician, then the explicitly assigned advisor; rejects unrelated technicians", async () => {
    const tenant=await seedTenant("Handoff",{withStaff:true});
    const ownerRun=<T>(fn:Parameters<typeof withTenant<T>>[2]) =>
      withTenant(tenant.businessId,tenant.owner.actor,fn);
    async function technician(name:string){
      const email=`${name.toLowerCase()}-${randomUUID()}@shop.example.test`;
      const inv=await ownerRun(tx=>inviteStaff(tx,meta(),{name,email,role:"technician"}));
      const subject=randomUUID();
      const identity=await acceptInvite(meta(),inv.token,{authSubject:subject,email,
        phoneE164:null,displayName:name});
      return {userId:identity.userId,actor:{type:"user" as const,id:identity.userId,authSubject:subject}};
    }
    const tech=await technician("Assigned Tech");
    const stranger=await technician("Other Tech");
    const techs=await ownerRun(tx=>listTechs(tx));
    expect(techs.map(t=>t.userId)).toContain(tech.userId);
    expect(techs.map(t=>t.userId)).not.toContain(tenant.staff!.userId);
    const advisors=await ownerRun(tx=>listAdvisors(tx));
    expect(advisors.map(a=>a.userId)).toContain(tenant.staff!.userId);
    expect(advisors.map(a=>a.userId)).not.toContain(tech.userId);
    const customer=await ownerRun(tx=>createCustomer(tx,meta(),{
      firstName:"Handoff",lastName:"Customer",
    }));
    const vehicle=await ownerRun(tx=>createVehicle(tx,meta(),{
      customerId:customer.id,make:"Ford",
    }));
    const job=await ownerRun(tx=>createJob(tx,{
      customerId:customer.id,vehicleId:vehicle.id,title:"Brake concern",
      parts:[],labor:[],
    }));
    await ownerRun(tx=>assignAdvisor(tx,meta(),{
      jobId:job.id,userId:tenant.staff!.userId,
    }));
    await ownerRun(tx=>assignJob(tx,meta(),{jobId:job.id,userId:tech.userId}));
    const techRun=<T>(fn:Parameters<typeof withTenant<T>>[2]) =>
      withTenant(tenant.businessId,tech.actor,fn);
    const otherRun=<T>(fn:Parameters<typeof withTenant<T>>[2]) =>
      withTenant(tenant.businessId,stranger.actor,fn);
    expect((await techRun(tx=>listMyJobHandoffs(tx))).map(h=>h.stage))
      .toEqual(["inspect_vehicle"]);
    expect((await techRun(tx=>listTasks(tx))).due.map(t=>t.subjectId))
      .toEqual([job.id]);
    expect(await otherRun(tx=>listMyJobHandoffs(tx))).toEqual([]);
    await expect(otherRun(tx=>assertAssignedTechnician(tx,job.id)))
      .rejects.toThrow(/not assigned/i);
    await techRun(tx=>assertAssignedTechnician(tx,job.id));
    const inspection=await techRun(tx=>getInspection(tx,job.id));
    expect(inspection.items).toHaveLength(40);
    await techRun(tx=>saveInspection(tx,meta(),{
      jobId:job.id,submit:true,
      items:inspection.items.map(item=>({...item,status:"good" as const})),
    }));
    expect(await techRun(tx=>listMyJobHandoffs(tx))).toEqual([]);
    const staffRun=<T>(fn:Parameters<typeof withTenant<T>>[2]) =>
      withTenant(tenant.businessId,tenant.staff!.actor,fn);
    const tasks=await staffRun(tx=>listMyJobHandoffs(tx));
    expect(tasks.map(t=>({stage:t.stage,recipient:t.recipientUserId})))
      .toEqual([{stage:"build_estimate",recipient:tenant.staff!.userId}]);
    expect(await ownerRun(tx=>listMyJobHandoffs(tx))).toEqual([]);
    // Changing the advisor reassigns the open Build Estimate task.
    await ownerRun(tx=>assignAdvisor(tx,meta(),{
      jobId:job.id,userId:tenant.owner.userId,
    }));
    expect(await staffRun(tx=>listMyJobHandoffs(tx))).toEqual([]);
    expect((await ownerRun(tx=>listMyJobHandoffs(tx)))[0].stage).toBe("build_estimate");
  });
});
