import { and, desc, eq, isNull } from "drizzle-orm";
import { assetReading, note, vehicle, vinDecodeCache } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { getCustomerWithVehicles, getVehicle } from "./customers";
import { recordActivity } from "./records";

export async function listNotes(
  tx: TenantTx,
  customerId: string,
  vehicleId?: string,
) {
  return tx
    .select()
    .from(note)
    .where(
      and(
        eq(note.businessId, tx.businessId),
        eq(note.customerId, customerId),
        vehicleId ? eq(note.vehicleId, vehicleId) : isNull(note.vehicleId),
        isNull(note.deletedAt),
      ),
    )
    .orderBy(desc(note.createdAt), desc(note.id))
    .limit(100);
}
export async function addNote(
  tx: TenantTx,
  customerId: string,
  vehicleId: string | null,
  body: string,
) {
  await getCustomerWithVehicles(tx, customerId);
  if (vehicleId) await getVehicle(tx, customerId, vehicleId);
  const [row] = await tx
    .insert(note)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      customerId,
      vehicleId,
      body,
    })
    .returning();
  await recordActivity(tx, {
    kind: "note.created",
    subjectType: vehicleId ? "vehicle" : "customer",
    subjectId: vehicleId ?? customerId,
    summary: "Note added",
    data: { noteId: row.id, text: body },
  });
  return { id: row.id };
}
export async function changeNote(
  tx: TenantTx,
  customerId: string,
  noteId: string,
  body: string | null,
  expectedUpdatedAt: string,
) {
  await getCustomerWithVehicles(tx, customerId);
  const [before] = await tx
    .select()
    .from(note)
    .where(
      and(
        eq(note.businessId, tx.businessId),
        eq(note.customerId, customerId),
        eq(note.id, noteId),
        isNull(note.deletedAt),
      ),
    )
    .for("update");
  if (!before) throw notFound("That note");
  if (before.updatedAt.toISOString() !== expectedUpdatedAt)
    throw new AppError(
      "CONFLICT",
      "This note changed. Refresh before saving your edit.",
    );
  await tx
    .update(note)
    .set(body === null ? { deletedAt: new Date() } : { body })
    .where(and(eq(note.businessId, tx.businessId), eq(note.id, noteId)));
  await recordActivity(tx, {
    kind: body === null ? "note.deleted" : "note.updated",
    subjectType: before.vehicleId ? "vehicle" : "customer",
    subjectId: before.vehicleId ?? customerId,
    summary: body === null ? "Note removed" : "Note edited",
    data: { noteId, before: before.body, after: body },
  });
  return { id: noteId };
}
export async function listReadings(tx: TenantTx, vehicleId: string) {
  return tx
    .select()
    .from(assetReading)
    .where(
      and(
        eq(assetReading.businessId, tx.businessId),
        eq(assetReading.assetId, vehicleId),
      ),
    )
    .orderBy(desc(assetReading.readOn), desc(assetReading.id))
    .limit(100);
}
export async function recordMileage(
  tx: TenantTx,
  customerId: string,
  vehicleId: string,
  value: number,
) {
  await getCustomerWithVehicles(tx, customerId);
  const [before] = await tx
    .select()
    .from(vehicle)
    .where(
      and(
        eq(vehicle.businessId, tx.businessId),
        eq(vehicle.id, vehicleId),
        eq(vehicle.customerId, customerId),
        eq(vehicle.status, "active"),
      ),
    )
    .for("update");
  if (!before) throw notFound("That vehicle");
  // The database trigger records changed values; an equal reading still records this visit.
  if (before.mileage === value)
    await tx.insert(assetReading).values({
      businessId: tx.businessId,
      assetId: vehicleId,
      value,
      createdByUserId: tx.actor.id,
    });
  else
    await tx
      .update(vehicle)
      .set({ mileage: value })
      .where(
        and(eq(vehicle.businessId, tx.businessId), eq(vehicle.id, vehicleId)),
      );
  await recordActivity(tx, {
    kind: "vehicle.mileage_recorded",
    subjectType: "vehicle",
    subjectId: vehicleId,
    summary: `Mileage recorded: ${value.toLocaleString()} mi`,
    data: { mileage: value },
  });
  return { id: vehicleId };
}
export async function cachedVin(tx: TenantTx, vin: string) {
  const [row] = await tx
    .select()
    .from(vinDecodeCache)
    .where(eq(vinDecodeCache.vin, vin));
  return row && Date.now() - row.decodedAt.getTime() < 180 * 24 * 60 * 60 * 1000
    ? row.payload
    : null;
}
export async function cacheVin(
  tx: TenantTx,
  vin: string,
  payload: typeof vinDecodeCache.$inferInsert.payload,
) {
  await tx
    .insert(vinDecodeCache)
    .values({ vin, payload })
    .onConflictDoUpdate({
      target: vinDecodeCache.vin,
      set: { payload, decodedAt: new Date() },
    });
}
