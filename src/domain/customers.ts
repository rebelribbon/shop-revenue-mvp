import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { activity, customer, vehicle } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import type { RequestMeta } from "./records";
import { audit, recordActivity } from "./records";

export type CustomerInput = {
  firstName: string;
  lastName: string;
  email?: string | null;
  phoneE164?: string | null;
  notes?: string | null;
};

const displayName = (firstName: string, lastName: string) => `${firstName} ${lastName}`.trim();
const phoneDigits = (phoneE164: string | null | undefined) => phoneE164?.replace(/\D/g, "") || null;

export async function createCustomer(tx: TenantTx, meta: RequestMeta, input: CustomerInput) {
  const name = displayName(input.firstName, input.lastName);
  if (!name) throw new AppError("VALIDATION", "Enter a customer name.");
  const [row] = await tx.insert(customer).values({
    businessId: tx.businessId,
    createdByUserId: tx.actor.id,
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: name,
    email: input.email ?? null,
    phoneE164: input.phoneE164 ?? null,
    phoneDigits: phoneDigits(input.phoneE164),
    notes: input.notes ?? null,
  }).returning();
  await audit(tx, meta, { action: "customer.created", targetType: "customer", targetId: row.id, after: { displayName: row.displayName } });
  await recordActivity(tx, { kind: "customer.created", subjectType: "customer", subjectId: row.id, summary: `Customer added: ${row.displayName}` });
  if (row.notes) await recordActivity(tx, { kind: "note.created", subjectType: "customer", subjectId: row.id, summary: "Customer note added", data: { text: row.notes } });
  return row;
}

export async function updateCustomer(tx: TenantTx, meta: RequestMeta, customerId: string, input: CustomerInput) {
  const [before] = await tx.select().from(customer).where(and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId), eq(customer.status, "active")));
  if (!before) throw notFound("That customer");
  const name = displayName(input.firstName, input.lastName);
  if (!name) throw new AppError("VALIDATION", "Enter a customer name.");
  const [row] = await tx.update(customer).set({
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: name,
    email: input.email ?? null,
    phoneE164: input.phoneE164 ?? null,
    phoneDigits: phoneDigits(input.phoneE164),
    notes: input.notes ?? null,
  }).where(and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId))).returning();
  await audit(tx, meta, { action: "customer.updated", targetType: "customer", targetId: row.id, before: { displayName: before.displayName }, after: { displayName: row.displayName } });
  await recordActivity(tx, { kind: "customer.updated", subjectType: "customer", subjectId: row.id, summary: `Customer updated: ${row.displayName}` });
  if (before.notes !== row.notes) await recordActivity(tx, { kind: "note.updated", subjectType: "customer", subjectId: row.id, summary: row.notes ? "Customer note updated" : "Customer note cleared", data: { before: before.notes, after: row.notes } });
  return row;
}

export async function archiveCustomer(tx: TenantTx, meta: RequestMeta, customerId: string) {
  const [row] = await tx.update(customer).set({ status: "archived" })
    .where(and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId), eq(customer.status, "active"))).returning();
  if (!row) throw notFound("That customer");
  await tx.update(vehicle).set({ status: "archived" })
    .where(and(eq(vehicle.businessId, tx.businessId), eq(vehicle.customerId, customerId), eq(vehicle.status, "active")));
  await audit(tx, meta, { action: "customer.archived", targetType: "customer", targetId: row.id, after: { status: "archived" } });
  await recordActivity(tx, { kind: "customer.archived", subjectType: "customer", subjectId: row.id, summary: `Customer archived: ${row.displayName}` });
  return row;
}

export type VehicleInput = {
  customerId: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  vin?: string | null;
  plate?: string | null;
  mileage?: number | null;
  notes?: string | null;
};

const normalizeVin = (vin: string | null | undefined) => vin?.replace(/\s/g, "").toUpperCase() || null;
const normalizePlate = (plate: string | null | undefined) => plate?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null;
const vehicleLabel = (v: { year?: number | null; make?: string | null; model?: string | null; vinLast6?: string | null }) =>
  [v.year, v.make, v.model].filter(Boolean).join(" ") || v.vinLast6 || "Vehicle";

async function requireActiveCustomer(tx: TenantTx, customerId: string) {
  const [owner] = await tx.select({ id: customer.id }).from(customer)
    .where(and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId), eq(customer.status, "active")));
  if (!owner) throw notFound("That customer");
}

export async function createVehicle(tx: TenantTx, meta: RequestMeta, input: VehicleInput) {
  await requireActiveCustomer(tx, input.customerId);
  const vin = normalizeVin(input.vin);
  const [row] = await tx.insert(vehicle).values({
    businessId: tx.businessId,
    createdByUserId: tx.actor.id,
    customerId: input.customerId,
    year: input.year ?? null,
    make: input.make || null,
    model: input.model || null,
    trim: input.trim || null,
    vin,
    vinLast6: vin && vin.length >= 6 ? vin.slice(-6) : null,
    plate: input.plate || null,
    plateNormalized: normalizePlate(input.plate),
    mileage: input.mileage ?? null,
    notes: input.notes ?? null,
  }).returning();
  const label = vehicleLabel(row);
  await audit(tx, meta, { action: "vehicle.created", targetType: "vehicle", targetId: row.id, after: { customerId: row.customerId, label } });
  await recordActivity(tx, { kind: "vehicle.created", subjectType: "vehicle", subjectId: row.id, summary: `Vehicle added: ${label}` });
  if (row.notes) await recordActivity(tx, { kind: "note.created", subjectType: "vehicle", subjectId: row.id, summary: "Vehicle note added", data: { text: row.notes } });
  if (row.mileage !== null) await recordActivity(tx, { kind: "vehicle.mileage_recorded", subjectType: "vehicle", subjectId: row.id, summary: `Mileage recorded: ${row.mileage.toLocaleString()} mi`, data: { mileage: row.mileage } });
  return row;
}

export async function updateVehicle(tx: TenantTx, meta: RequestMeta, vehicleId: string, input: VehicleInput) {
  await requireActiveCustomer(tx, input.customerId);
  const [before] = await tx.select().from(vehicle).where(and(eq(vehicle.businessId, tx.businessId), eq(vehicle.id, vehicleId), eq(vehicle.customerId, input.customerId), eq(vehicle.status, "active")));
  if (!before) throw notFound("That vehicle");
  const vin = normalizeVin(input.vin);
  const [row] = await tx.update(vehicle).set({
    year: input.year ?? null,
    make: input.make || null,
    model: input.model || null,
    trim: input.trim || null,
    vin,
    vinLast6: vin && vin.length >= 6 ? vin.slice(-6) : null,
    plate: input.plate || null,
    plateNormalized: normalizePlate(input.plate),
    mileage: input.mileage ?? null,
    notes: input.notes ?? null,
  }).where(and(eq(vehicle.businessId, tx.businessId), eq(vehicle.id, vehicleId))).returning();
  await audit(tx, meta, { action: "vehicle.updated", targetType: "vehicle", targetId: row.id, before: { label: vehicleLabel(before) }, after: { label: vehicleLabel(row) } });
  await recordActivity(tx, { kind: "vehicle.updated", subjectType: "vehicle", subjectId: row.id, summary: `Vehicle updated: ${vehicleLabel(row)}` });
  if (before.notes !== row.notes) await recordActivity(tx, { kind: "note.updated", subjectType: "vehicle", subjectId: row.id, summary: row.notes ? "Vehicle note updated" : "Vehicle note cleared", data: { before: before.notes, after: row.notes } });
  if (before.mileage !== row.mileage && row.mileage !== null) await recordActivity(tx, { kind: "vehicle.mileage_recorded", subjectType: "vehicle", subjectId: row.id, summary: `Mileage recorded: ${row.mileage.toLocaleString()} mi`, data: { mileage: row.mileage } });
  return row;
}

export async function archiveVehicle(tx: TenantTx, meta: RequestMeta, customerId: string, vehicleId: string) {
  const [row] = await tx.update(vehicle).set({ status: "archived" })
    .where(and(eq(vehicle.businessId, tx.businessId), eq(vehicle.customerId, customerId), eq(vehicle.id, vehicleId), eq(vehicle.status, "active"))).returning();
  if (!row) throw notFound("That vehicle");
  await audit(tx, meta, { action: "vehicle.archived", targetType: "vehicle", targetId: row.id, after: { status: "archived" } });
  await recordActivity(tx, { kind: "vehicle.archived", subjectType: "vehicle", subjectId: row.id, summary: `Vehicle archived: ${vehicleLabel(row)}` });
  return row;
}

export async function listCustomers(tx: TenantTx, query?: string) {
  const q = query?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const vinOrPlate = q?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() ?? "";
  if (q) {
    return tx.selectDistinct({ id: customer.id, displayName: customer.displayName, email: customer.email, phoneE164: customer.phoneE164, updatedAt: customer.updatedAt })
      .from(customer)
      .leftJoin(vehicle, and(eq(vehicle.businessId, customer.businessId), eq(vehicle.customerId, customer.id), eq(vehicle.status, "active")))
      .where(and(eq(customer.businessId, tx.businessId), eq(customer.status, "active"), or(
        ilike(customer.displayName, `%${q}%`),
        ilike(customer.email, `%${q.toLowerCase()}%`),
        digits.length >= 4 ? sql`${customer.phoneDigits} LIKE ${`%${digits}%`}` : undefined,
        vinOrPlate.length >= 2 ? eq(vehicle.plateNormalized, vinOrPlate) : undefined,
        vinOrPlate.length === 6 ? eq(vehicle.vinLast6, vinOrPlate) : undefined,
      )))
      .orderBy(asc(customer.displayName)).limit(100);
  }
  return tx.select({ id: customer.id, displayName: customer.displayName, email: customer.email, phoneE164: customer.phoneE164, updatedAt: customer.updatedAt })
    .from(customer).where(and(eq(customer.businessId, tx.businessId), eq(customer.status, "active")))
    .orderBy(desc(customer.updatedAt)).limit(100);
}

export async function getCustomerWithVehicles(tx: TenantTx, customerId: string) {
  const [c] = await tx.select().from(customer)
    .where(and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId), eq(customer.status, "active")));
  if (!c) throw notFound("That customer");
  const vehicles = await tx.select().from(vehicle)
    .where(and(eq(vehicle.businessId, tx.businessId), eq(vehicle.customerId, customerId), eq(vehicle.status, "active")))
    .orderBy(desc(vehicle.updatedAt));
  return { customer: c, vehicles };
}

export async function getVehicle(tx: TenantTx, customerId: string, vehicleId: string) {
  const [row] = await tx.select().from(vehicle)
    .where(and(eq(vehicle.businessId, tx.businessId), eq(vehicle.customerId, customerId), eq(vehicle.id, vehicleId), eq(vehicle.status, "active")));
  if (!row) throw notFound("That vehicle");
  return row;
}

export async function listCustomerTimeline(tx: TenantTx, customerId: string) {
  const ownedVehicles = await tx.select({ id: vehicle.id }).from(vehicle)
    .where(and(eq(vehicle.businessId, tx.businessId), eq(vehicle.customerId, customerId)));
  const ids = ownedVehicles.map((v) => v.id);
  const subject = ids.length
    ? or(and(eq(activity.subjectType, "customer"), eq(activity.subjectId, customerId)), and(eq(activity.subjectType, "vehicle"), inArray(activity.subjectId, ids)))
    : and(eq(activity.subjectType, "customer"), eq(activity.subjectId, customerId));
  return tx.select({ id: activity.id, kind: activity.kind, summary: activity.summary, occurredAt: activity.occurredAt })
    .from(activity)
    .where(and(eq(activity.businessId, tx.businessId), subject))
    .orderBy(desc(activity.occurredAt)).limit(100);
}
