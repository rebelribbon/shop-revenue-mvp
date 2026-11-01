import { and, asc, eq, gte, lt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  appointment,
  asset,
  business,
  customer,
  recoveryItem,
  vehicle,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import {
  validateRecoverySource,
  validateContactSource,
} from "./recovery-source";
import { getServiceAsset } from "./service-assets";
import { AppError, notFound } from "@/lib/errors";
import {
  addLocalDays,
  localDateKey,
  localDateTimeToUtc,
  localMidnightToUtc,
} from "@/lib/timezone";
import type { RequestMeta } from "./records";
import { audit, recordActivity } from "./records";

async function shopTimezone(tx: TenantTx) {
  const [b] = await tx
    .select({ timezone: business.timezone })
    .from(business)
    .where(eq(business.id, tx.businessId));
  return b?.timezone || "America/Chicago";
}

export async function listAppointmentChoices(tx: TenantTx) {
  const customers = await tx
    .select({ id: customer.id, name: customer.displayName })
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.status, "active"),
      ),
    )
    .orderBy(asc(customer.displayName));
  const vehicles = await tx
    .select({
      id: vehicle.id,
      customerId: vehicle.customerId,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      plate: vehicle.plate,
    })
    .from(vehicle)
    .where(
      and(eq(vehicle.businessId, tx.businessId), eq(vehicle.status, "active")),
    );
  const serviceAssets = await tx
    .select({
      id: asset.id,
      customerId: asset.customerId,
      displayName: asset.displayName,
    })
    .from(asset)
    .where(
      and(
        eq(asset.businessId, tx.businessId),
        eq(asset.status, "active"),
        inArray(asset.type, ["property", "equipment"]),
      ),
    );
  return { customers, vehicles, serviceAssets };
}

export async function createAppointment(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    customerId: string;
    sourceRecoveryItemId?: string;
    sourceContactActivityId?: string;
    vehicleId?: string | null;
    serviceAssetId?: string | null;
    localStartsAt: string;
    reason?: string | null;
    notes?: string | null;
  },
) {
  const [c] = await tx
    .select({ id: customer.id, name: customer.displayName })
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, input.customerId),
        eq(customer.status, "active"),
      ),
    );
  if (!c) throw notFound("That customer");
  if (input.vehicleId && input.serviceAssetId)
    throw new AppError(
      "VALIDATION",
      "Choose a vehicle or service asset, not both.",
    );
  if (input.serviceAssetId)
    await getServiceAsset(tx, input.customerId, input.serviceAssetId);
  if (input.vehicleId) {
    const [v] = await tx
      .select({ id: vehicle.id })
      .from(vehicle)
      .where(
        and(
          eq(vehicle.businessId, tx.businessId),
          eq(vehicle.customerId, input.customerId),
          eq(vehicle.id, input.vehicleId),
          eq(vehicle.status, "active"),
        ),
      );
    if (!v) throw notFound("That vehicle");
  }
  await validateRecoverySource(
    tx,
    input.sourceRecoveryItemId,
    input.customerId,
    input.vehicleId,
    input.serviceAssetId,
  );
  await validateContactSource(
    tx,
    input.sourceContactActivityId,
    input.sourceRecoveryItemId,
  );
  const timezone = await shopTimezone(tx);
  const startsAt = localDateTimeToUtc(input.localStartsAt, timezone);
  const [row] = await tx
    .insert(appointment)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      customerId: input.customerId,
      sourceRecoveryItemId: input.sourceRecoveryItemId ?? null,
      sourceContactActivityId: input.sourceContactActivityId ?? null,
      vehicleId: input.vehicleId || null,
      serviceAssetId: input.serviceAssetId || null,
      startsAt,
      reason: input.reason || null,
      notes: input.notes || null,
    })
    .returning();
  if (input.sourceRecoveryItemId)
    await tx
      .update(recoveryItem)
      .set({ status: "booked", snoozedUntil: null })
      .where(
        and(
          eq(recoveryItem.businessId, tx.businessId),
          eq(recoveryItem.id, input.sourceRecoveryItemId),
        ),
      );
  await audit(tx, meta, {
    action: "appointment.created",
    targetType: "appointment",
    targetId: row.id,
    after: { customerId: row.customerId, startsAt: row.startsAt.toISOString() },
  });
  await recordActivity(tx, {
    kind: "appointment.created",
    subjectType: "customer",
    subjectId: row.customerId,
    summary: `Visit booked for ${c.name}`,
    data: {
      appointmentId: row.id,
      sourceRecoveryItemId: row.sourceRecoveryItemId,
    },
  });
  return row;
}

export async function setAppointmentStatus(
  tx: TenantTx,
  meta: RequestMeta,
  appointmentId: string,
  status: "scheduled" | "completed" | "cancelled" | "no_show",
) {
  const [before] = await tx
    .select()
    .from(appointment)
    .where(
      and(
        eq(appointment.businessId, tx.businessId),
        eq(appointment.id, appointmentId),
      ),
    );
  if (!before) throw notFound("That appointment");
  const [row] = await tx
    .update(appointment)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(appointment.businessId, tx.businessId),
        eq(appointment.id, appointmentId),
      ),
    )
    .returning();
  await audit(tx, meta, {
    action: "appointment.status_updated",
    targetType: "appointment",
    targetId: row.id,
    before: { status: before.status },
    after: { status },
  });
  await recordActivity(tx, {
    kind: "appointment.updated",
    subjectType: "customer",
    subjectId: row.customerId,
    summary: `Visit marked ${status.replace("_", " ")}`,
    data: { appointmentId: row.id },
  });
  return row;
}

export async function listVisitsRange(
  tx: TenantTx,
  startDay: string,
  endDay: string,
) {
  const timezone = await shopTimezone(tx),
    start = localMidnightToUtc(startDay, timezone),
    end = localMidnightToUtc(endDay, timezone);
  const property = alias(asset, "appointment_service_property");
  const rows = await tx
    .select({
      id: appointment.id,
      customerId: appointment.customerId,
      customerName: customer.displayName,
      sourceRecoveryItemId: appointment.sourceRecoveryItemId,
      sourceContactActivityId: appointment.sourceContactActivityId,
      vehicleId: appointment.vehicleId,
      serviceAssetId: appointment.serviceAssetId,
      serviceAssetName: asset.displayName,
      serviceAddress: sql<string>`concat_ws(', ',
      coalesce(NULLIF(${asset.details}->>'addressLine1',''),NULLIF(${property.details}->>'addressLine1','')),
      coalesce(NULLIF(${asset.details}->>'addressLine2',''),NULLIF(${property.details}->>'addressLine2','')),
      coalesce(NULLIF(${asset.details}->>'city',''),NULLIF(${property.details}->>'city','')),
      coalesce(NULLIF(${asset.details}->>'region',''),NULLIF(${property.details}->>'region','')),
      coalesce(NULLIF(${asset.details}->>'postalCode',''),NULLIF(${property.details}->>'postalCode','')))`,
      startsAt: appointment.startsAt,
      reason: appointment.reason,
      notes: appointment.notes,
      status: appointment.status,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      plate: vehicle.plate,
    })
    .from(appointment)
    .innerJoin(
      customer,
      and(
        eq(customer.businessId, appointment.businessId),
        eq(customer.id, appointment.customerId),
      ),
    )
    .leftJoin(
      asset,
      and(
        eq(asset.businessId, appointment.businessId),
        eq(asset.id, appointment.serviceAssetId),
      ),
    )
    .leftJoin(
      property,
      and(
        eq(property.businessId, asset.businessId),
        eq(property.customerId, asset.customerId),
        eq(property.id, asset.parentAssetId),
      ),
    )
    .leftJoin(
      vehicle,
      and(
        eq(vehicle.businessId, appointment.businessId),
        eq(vehicle.id, appointment.vehicleId),
      ),
    )
    .where(
      and(
        eq(appointment.businessId, tx.businessId),
        gte(appointment.startsAt, start),
        lt(appointment.startsAt, end),
      ),
    )
    .orderBy(asc(appointment.startsAt));
  return { timezone, rows };
}
export async function listTodayTomorrow(tx: TenantTx, now = new Date()) {
  const timezone = await shopTimezone(tx),
    today = localDateKey(now, timezone),
    tomorrow = addLocalDays(today, 1);
  const { rows } = await listVisitsRange(tx, today, addLocalDays(today, 2));
  return {
    timezone,
    today: rows.filter((r) => localDateKey(r.startsAt, timezone) === today),
    tomorrow: rows.filter(
      (r) => localDateKey(r.startsAt, timezone) === tomorrow,
    ),
  };
}
