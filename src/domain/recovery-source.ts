import { and, eq } from "drizzle-orm";
import { activity, appointment, recoveryItem } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
export async function validateRecoverySource(tx:TenantTx,id:string|undefined,customerId:string,vehicleId?:string|null) {
 if(!id) return;
 const [source]=await tx.select().from(recoveryItem).where(and(eq(recoveryItem.businessId,tx.businessId),eq(recoveryItem.id,id)));
 if(!source||source.customerId!==customerId||(source.vehicleId&&source.vehicleId!==vehicleId)||source.status==='dismissed')
   throw new AppError('VALIDATION','The opportunity does not match this customer and vehicle. Start again from Money Finder.');
}

export async function validateContactSource(tx:TenantTx,id:string|undefined,recoveryId:string|undefined){
 if(!id)return;
 const [contact]=await tx.select().from(activity).where(and(eq(activity.businessId,tx.businessId),eq(activity.id,id),eq(activity.kind,'recovery.contact')));
 if(!contact||!recoveryId||(contact.data as Record<string,unknown>).recoveryItemId!==recoveryId)throw new AppError('VALIDATION','The manual contact does not match this opportunity.');
}
export async function validateAppointmentSource(tx:TenantTx,id:string|undefined,customerId:string,vehicleId:string,recoveryId?:string,contactId?:string){
 if(!id)return;
 const [row]=await tx.select().from(appointment).where(and(eq(appointment.businessId,tx.businessId),eq(appointment.id,id)));
 if(!row||row.customerId!==customerId||row.vehicleId!==vehicleId||row.sourceRecoveryItemId!==(recoveryId??null)||row.sourceContactActivityId!==(contactId??null))throw new AppError('VALIDATION','The appointment does not match this job source.');
}
