import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { customer, vehicle } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import type { RequestMeta } from "./records";
import { audit, recordActivity } from "./records";

export type CreateCustomerInput = {
  firstName: string;
  lastName: string;
  email?: string | null;
  phoneE164?: string | null;
  notes?: string | null;
};

const displayName = (firstName: string, lastName: string) => `${firstName} ${lastName}`.trim();
const phoneDigits = (phoneE164: string | null | undefined) => phoneE164?.replace(/\D/g, "") || null;

export async function createCustomer(tx: TenantTx, meta: RequestMeta, input: CreateCustomerInput) {
  const name = displayName(input.firstName, input.lastName);
  if (!name) throw new AppError("VALIDATION", "Enter a customer name.");
  const [row] = await tx
    .insert(customer)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: name,
      email: input.email ?? null,
      phoneE164: input.phoneE164 ?? null,
      phoneDigits: phoneDigits(input.phoneE164),
      notes: input.notes ?? null,
    })
    .returning();
  await audit(tx, meta, { action: "customer.created", targetType: "customer", targetId: row.id, after: { displayName: row.displayName } });
  await recordActivity(tx, { kind: "customer.created", subjectType: "customer", subjectId: row.id, summary: `Customer added: ${row.displayName}` });
  return row;
}

export type CreateVehicleInput = {
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

export async function createVehicle(tx: TenantTx, meta: RequestMeta, input: CreateVehicleInput) {
  const [owner] = await tx
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.businessId, tx.businessId), eq(customer.id, input.customerId), eq(customer.status, "active")));
  if (!owner) throw notFound("That customer");

  const vin = normalizeVin(input.vin);
  const plateNormalized = normalizePlate(input.plate);
  const [row] = await tx
    .insert(vehicle)
    .values({
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
      plateNormalized,
      mileage: input.mileage ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  const label = [row.year, row.make, row.model].filter(Boolean).join(" ") || row.vinLast6 || "Vehicle";
  await audit(tx, meta, { action: "vehicle.created", targetType: "vehicle", targetId: row.id, after: { customerId: row.customerId, label } });
  await recordActivity(tx, { kind: "vehicle.created", subjectType: "vehicle", subjectId: row.id, summary: `Vehicle added: ${label}` });
  return row;
}

export async function listCustomers(tx: TenantTx, query?: string) {
  const q = query?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const vinOrPlate = q?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() ?? "";

  if (q) {
    return tx
      .selectDistinct({
        id: customer.id,
        displayName: customer.displayName,
        email: customer.email,
        phoneE164: customer.phoneE164,
        updatedAt: customer.updatedAt,
      })
      .from(customer)
      .leftJoin(vehicle, and(eq(vehicle.businessId, customer.businessId), eq(vehicle.customerId, customer.id), eq(vehicle.status, "active")))
      .where(
        and(
          eq(customer.businessId, tx.businessId),
          eq(customer.status, "active"),
          or(
            ilike(customer.displayName, `%${q}%`),
            ilike(customer.email, `%${q.toLowerCase()}%`),
            digits.length >= 4 ? sql`${customer.phoneDigits} LIKE ${`%${digits}%`}` : undefined,
            vinOrPlate.length >= 2 ? eq(vehicle.plateNormalized, vinOrPlate) : undefined,
            vinOrPlate.length === 6 ? eq(vehicle.vinLast6, vinOrPlate) : undefined,
          ),
        ),
      )
      .orderBy(asc(customer.displayName))
      .limit(100);
  }

  return tx
    .select({
      id: customer.id,
      displayName: customer.displayName,
      email: customer.email,
      phoneE164: customer.phoneE164,
      updatedAt: customer.updatedAt,
    })
    .from(customer)
    .where(and(eq(customer.businessId, tx.businessId), eq(customer.status, "active")))
    .orderBy(desc(customer.updatedAt))
    .limit(100);
}

export async function getCustomerWithVehicles(tx: TenantTx, customerId: string) {
  const [c] = await tx
    .select()
    .from(customer)
    .where(and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId), eq(customer.status, "active")));
  if (!c) throw notFound("That customer");
  const vehicles = await tx
    .select()
    .from(vehicle)
    .where(and(eq(vehicle.businessId, tx.businessId), eq(vehicle.customerId, customerId), eq(vehicle.status, "active")))
    .orderBy(desc(vehicle.updatedAt));
  return { customer: c, vehicles };
}
