import { and, eq } from "drizzle-orm";
import { recoveryItem } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
export async function validateRecoverySource(tx:TenantTx,id:string|undefined,customerId:string,vehicleId?:string|null) {
 if(!id) return;
 const [source]=await tx.select().from(recoveryItem).where(and(eq(recoveryItem.businessId,tx.businessId),eq(recoveryItem.id,id)));
 if(!source||source.customerId!==customerId||(source.vehicleId&&source.vehicleId!==vehicleId)||source.status==='dismissed')
   throw new AppError('VALIDATION','The opportunity does not match this customer and vehicle. Start again from Money Finder.');
}
