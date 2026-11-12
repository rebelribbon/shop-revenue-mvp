import type { LeadSource } from "@/lib/lead-sources";
import { LEAD_SOURCE_KEYS } from "@/lib/lead-sources";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { activity, asset, customer, membership, vehicle } from "@/db/schema";
import { canManageTeam } from "./membership";
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
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  // Where they found the shop (only used when adding a customer).
  leadSource?: LeadSource | null;
  leadSourceDetail?: string | null;
  // Set when the owner confirmed a same-phone/email customer is a different person.
  allowDuplicate?: boolean;
  assignedUserId?: string;
};

const displayName = (firstName: string, lastName: string) =>
  `${firstName} ${lastName}`.trim();
const phoneDigits = (phoneE164: string | null | undefined) =>
  phoneE164?.replace(/\D/g, "") || null;

// Same mobile number or email as an active customer usually means the person
// is already on file (a second record splits their history and follow-ups).
export async function findMatchingCustomer(
  tx: TenantTx,
  input: Pick<CustomerInput, "email" | "phoneE164">,
) {
  const digits = phoneDigits(input.phoneE164);
  const email = input.email?.toLowerCase() || null;
  if (!digits && !email) return null;
  const [row] = await tx
    .select({
      id: customer.id,
      displayName: customer.displayName,
      phoneDigits: customer.phoneDigits,
    })
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.status, "active"),
        or(
          digits ? eq(customer.phoneDigits, digits) : sql`false`,
          email ? eq(customer.email, email) : sql`false`,
        ),
      ),
    )
    .orderBy(asc(customer.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.displayName,
    by: digits && row.phoneDigits === digits ? "mobile number" : "email",
  };
}

export async function createCustomer(
  tx: TenantTx,
  meta: RequestMeta,
  input: CustomerInput,
) {
  const name = displayName(input.firstName, input.lastName);
  if (!name) throw new AppError("VALIDATION", "Enter a customer name.");
  const assignee =
    input.assignedUserId ?? (tx.actor.type === "user" ? tx.actor.id : null);
  if (tx.actor.type === "user" && !assignee)
    throw new AppError("VALIDATION", "Choose an assigned service advisor.");
  if (assignee && tx.actor.type === "user") {
    if (assignee !== tx.actor.id && !(await canManageTeam(tx)))
      throw new AppError(
        "FORBIDDEN",
        "Only management may assign customers to another employee.",
      );
    const [member] = await tx
      .select({ id: membership.id })
      .from(membership)
      .where(
        and(
          eq(membership.businessId, tx.businessId),
          eq(membership.userId, assignee),
          eq(membership.status, "active"),
          inArray(membership.role, ["staff", "owner"]),
        ),
      );
    if (!member)
      throw new AppError("VALIDATION", "Choose an active advisor or owner.");
  }
  if (!input.allowDuplicate) {
    const match = await findMatchingCustomer(tx, input);
    if (match)
      throw new AppError(
        "CONFLICT",
        `${match.displayName} already has this ${match.by}. Open their record instead, or add a separate customer if this is a different person.`,
        { duplicate: { id: match.id, name: match.displayName } },
      );
  }
  const [row] = await tx
    .insert(customer)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      assignedUserId: assignee,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: name,
      email: input.email ?? null,
      phoneE164: input.phoneE164 ?? null,
      phoneDigits: phoneDigits(input.phoneE164),
      leadSource: input.leadSource ?? null,
      leadSourceDetail: input.leadSourceDetail?.trim() || null,
      notes: input.notes ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      postalCode: input.postalCode ?? null,
    })
    .returning();
  await audit(tx, meta, {
    action: "customer.created",
    targetType: "customer",
    targetId: row.id,
    after: { displayName: row.displayName },
  });
  await recordActivity(tx, {
    kind: "customer.created",
    subjectType: "customer",
    subjectId: row.id,
    summary: `Customer added: ${row.displayName}`,
  });
  if (row.notes)
    await recordActivity(tx, {
      kind: "note.created",
      subjectType: "customer",
      subjectId: row.id,
      summary: "Customer note added",
      data: { text: row.notes },
    });
  return row;
}

export async function updateCustomer(
  tx: TenantTx,
  meta: RequestMeta,
  customerId: string,
  input: CustomerInput,
) {
  const [before] = await tx
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, customerId),
        eq(customer.status, "active"),
      ),
    );
  if (!before) throw notFound("That customer");
  const name = displayName(input.firstName, input.lastName);
  if (!name) throw new AppError("VALIDATION", "Enter a customer name.");
  const [row] = await tx
    .update(customer)
    .set({
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: name,
      email: input.email ?? null,
      phoneE164: input.phoneE164 ?? null,
      phoneDigits: phoneDigits(input.phoneE164),
      notes: input.notes ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      postalCode: input.postalCode ?? null,
    })
    .where(
      and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId)),
    )
    .returning();
  await audit(tx, meta, {
    action: "customer.updated",
    targetType: "customer",
    targetId: row.id,
    before: { displayName: before.displayName },
    after: { displayName: row.displayName },
  });
  await recordActivity(tx, {
    kind: "customer.updated",
    subjectType: "customer",
    subjectId: row.id,
    summary: `Customer updated: ${row.displayName}`,
  });
  if (before.notes !== row.notes)
    await recordActivity(tx, {
      kind: "note.updated",
      subjectType: "customer",
      subjectId: row.id,
      summary: row.notes ? "Customer note updated" : "Customer note cleared",
      data: { before: before.notes, after: row.notes },
    });
  return row;
}

export async function archiveCustomer(
  tx: TenantTx,
  meta: RequestMeta,
  customerId: string,
) {
  const [row] = await tx
    .update(customer)
    .set({ status: "archived" })
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, customerId),
        eq(customer.status, "active"),
      ),
    )
    .returning();
  if (!row) throw notFound("That customer");
  await tx
    .update(vehicle)
    .set({ status: "archived" })
    .where(
      and(
        eq(vehicle.businessId, tx.businessId),
        eq(vehicle.customerId, customerId),
        eq(vehicle.status, "active"),
      ),
    );
  await tx
    .update(asset)
    .set({ status: "inactive" })
    .where(
      and(
        eq(asset.businessId, tx.businessId),
        eq(asset.customerId, customerId),
        eq(asset.status, "active"),
      ),
    );
  await audit(tx, meta, {
    action: "customer.archived",
    targetType: "customer",
    targetId: row.id,
    after: { status: "archived" },
  });
  await recordActivity(tx, {
    kind: "customer.archived",
    subjectType: "customer",
    subjectId: row.id,
    summary: `Customer archived: ${row.displayName}`,
  });
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

const normalizeVin = (vin: string | null | undefined) =>
  vin?.replace(/\s/g, "").toUpperCase() || null;
const normalizePlate = (plate: string | null | undefined) =>
  plate?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null;
const vehicleLabel = (v: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  vinLast6?: string | null;
}) =>
  [v.year, v.make, v.model].filter(Boolean).join(" ") ||
  v.vinLast6 ||
  "Vehicle";

async function requireActiveCustomer(tx: TenantTx, customerId: string) {
  const [owner] = await tx
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, customerId),
        eq(customer.status, "active"),
      ),
    );
  if (!owner) throw notFound("That customer");
}

export async function createVehicle(
  tx: TenantTx,
  meta: RequestMeta,
  input: VehicleInput,
) {
  await requireActiveCustomer(tx, input.customerId);
  const vin = normalizeVin(input.vin);
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
      plateNormalized: normalizePlate(input.plate),
      mileage: input.mileage ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  const label = vehicleLabel(row);
  await audit(tx, meta, {
    action: "vehicle.created",
    targetType: "vehicle",
    targetId: row.id,
    after: { customerId: row.customerId, label },
  });
  await recordActivity(tx, {
    kind: "vehicle.created",
    subjectType: "vehicle",
    subjectId: row.id,
    summary: `Vehicle added: ${label}`,
  });
  if (row.notes)
    await recordActivity(tx, {
      kind: "note.created",
      subjectType: "vehicle",
      subjectId: row.id,
      summary: "Vehicle note added",
      data: { text: row.notes },
    });
  if (row.mileage !== null)
    await recordActivity(tx, {
      kind: "vehicle.mileage_recorded",
      subjectType: "vehicle",
      subjectId: row.id,
      summary: `Mileage recorded: ${row.mileage.toLocaleString()} mi`,
      data: { mileage: row.mileage },
    });
  return row;
}

export async function updateVehicle(
  tx: TenantTx,
  meta: RequestMeta,
  vehicleId: string,
  input: VehicleInput,
) {
  await requireActiveCustomer(tx, input.customerId);
  const [before] = await tx
    .select()
    .from(vehicle)
    .where(
      and(
        eq(vehicle.businessId, tx.businessId),
        eq(vehicle.id, vehicleId),
        eq(vehicle.customerId, input.customerId),
        eq(vehicle.status, "active"),
      ),
    );
  if (!before) throw notFound("That vehicle");
  const vin = normalizeVin(input.vin);
  const [row] = await tx
    .update(vehicle)
    .set({
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
    })
    .where(
      and(eq(vehicle.businessId, tx.businessId), eq(vehicle.id, vehicleId)),
    )
    .returning();
  await audit(tx, meta, {
    action: "vehicle.updated",
    targetType: "vehicle",
    targetId: row.id,
    before: { label: vehicleLabel(before) },
    after: { label: vehicleLabel(row) },
  });
  await recordActivity(tx, {
    kind: "vehicle.updated",
    subjectType: "vehicle",
    subjectId: row.id,
    summary: `Vehicle updated: ${vehicleLabel(row)}`,
  });
  if (before.notes !== row.notes)
    await recordActivity(tx, {
      kind: "note.updated",
      subjectType: "vehicle",
      subjectId: row.id,
      summary: row.notes ? "Vehicle note updated" : "Vehicle note cleared",
      data: { before: before.notes, after: row.notes },
    });
  if (before.mileage !== row.mileage && row.mileage !== null)
    await recordActivity(tx, {
      kind: "vehicle.mileage_recorded",
      subjectType: "vehicle",
      subjectId: row.id,
      summary: `Mileage recorded: ${row.mileage.toLocaleString()} mi`,
      data: { mileage: row.mileage },
    });
  return row;
}

export async function archiveVehicle(
  tx: TenantTx,
  meta: RequestMeta,
  customerId: string,
  vehicleId: string,
) {
  const [row] = await tx
    .update(vehicle)
    .set({ status: "archived" })
    .where(
      and(
        eq(vehicle.businessId, tx.businessId),
        eq(vehicle.customerId, customerId),
        eq(vehicle.id, vehicleId),
        eq(vehicle.status, "active"),
      ),
    )
    .returning();
  if (!row) throw notFound("That vehicle");
  await audit(tx, meta, {
    action: "vehicle.archived",
    targetType: "vehicle",
    targetId: row.id,
    after: { status: "archived" },
  });
  await recordActivity(tx, {
    kind: "vehicle.archived",
    subjectType: "vehicle",
    subjectId: row.id,
    summary: `Vehicle archived: ${vehicleLabel(row)}`,
  });
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
      .leftJoin(
        vehicle,
        and(
          eq(vehicle.businessId, customer.businessId),
          eq(vehicle.customerId, customer.id),
          eq(vehicle.status, "active"),
        ),
      )
      .where(
        and(
          eq(customer.businessId, tx.businessId),
          eq(customer.status, "active"),
          or(
            ilike(customer.displayName, `%${q}%`),
            ilike(customer.email, `%${q.toLowerCase()}%`),
            sql`EXISTS (SELECT 1 FROM app.asset a WHERE a.business_id=${tx.businessId} AND a.customer_id=${customer.id} AND a.status='active' AND (a.display_name ILIKE ${`%${q}%`} OR a.details->>'addressLine1' ILIKE ${`%${q}%`} OR a.details->>'postalCode' ILIKE ${`%${q}%`} OR a.details->>'serialNumber' ILIKE ${`%${q}%`}))`,
            digits.length >= 4
              ? sql`${customer.phoneDigits} LIKE ${`%${digits}%`}`
              : undefined,
            vinOrPlate.length >= 2
              ? eq(vehicle.plateNormalized, vinOrPlate)
              : undefined,
            vinOrPlate.length === 6
              ? eq(vehicle.vinLast6, vinOrPlate)
              : undefined,
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
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.status, "active"),
      ),
    )
    .orderBy(desc(customer.updatedAt))
    .limit(100);
}

export async function getCustomerWithVehicles(
  tx: TenantTx,
  customerId: string,
) {
  const [c] = await tx
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, customerId),
        eq(customer.status, "active"),
      ),
    );
  if (!c) throw notFound("That customer");
  const vehicles = await tx
    .select()
    .from(vehicle)
    .where(
      and(
        eq(vehicle.businessId, tx.businessId),
        eq(vehicle.customerId, customerId),
        eq(vehicle.status, "active"),
      ),
    )
    .orderBy(desc(vehicle.updatedAt));
  return { customer: c, vehicles };
}

export async function getVehicle(
  tx: TenantTx,
  customerId: string,
  vehicleId: string,
) {
  const [row] = await tx
    .select()
    .from(vehicle)
    .where(
      and(
        eq(vehicle.businessId, tx.businessId),
        eq(vehicle.customerId, customerId),
        eq(vehicle.id, vehicleId),
        eq(vehicle.status, "active"),
      ),
    );
  if (!row) throw notFound("That vehicle");
  return row;
}

export async function listCustomerTimeline(tx: TenantTx, customerId: string) {
  const ownedVehicles = await tx
    .select({ id: vehicle.id })
    .from(vehicle)
    .where(
      and(
        eq(vehicle.businessId, tx.businessId),
        eq(vehicle.customerId, customerId),
      ),
    );
  const ids = ownedVehicles.map((v) => v.id);
  const subject = ids.length
    ? or(
        and(
          eq(activity.subjectType, "customer"),
          eq(activity.subjectId, customerId),
        ),
        and(
          eq(activity.subjectType, "vehicle"),
          inArray(activity.subjectId, ids),
        ),
      )
    : and(
        eq(activity.subjectType, "customer"),
        eq(activity.subjectId, customerId),
      );
  return tx
    .select({
      id: activity.id,
      kind: activity.kind,
      summary: activity.summary,
      data: activity.data,
      actorId: activity.actorId,
      actorType: activity.actorType,
      subjectId: activity.subjectId,
      occurredAt: activity.occurredAt,
    })
    .from(activity)
    .where(and(eq(activity.businessId, tx.businessId), subject))
    .orderBy(desc(activity.occurredAt))
    .limit(100);
}

export type ContactChannel = "text" | "email";

// Stop or restart texts or emails to one customer. A stop is recorded with the
// time it was entered, so the business can show it honoured the request.
export async function setContactPermission(
  tx: TenantTx,
  meta: RequestMeta,
  customerId: string,
  channel: ContactChannel,
  allowed: boolean,
) {
  const column = channel === "text" ? "textOptedOutAt" : "emailOptedOutAt";
  const [before] = await tx
    .select({ at: customer[column] })
    .from(customer)
    .where(
      and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId)),
    );
  if (!before) throw notFound("That customer");
  const already = allowed ? before.at === null : before.at !== null;
  if (already) return { id: customerId, changed: false };
  await tx
    .update(customer)
    .set({ [column]: allowed ? null : new Date() })
    .where(
      and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId)),
    );
  const label = channel === "text" ? "Texts" : "Emails";
  await audit(tx, meta, {
    action: "customer.contact_permission",
    targetType: "customer",
    targetId: customerId,
    before: { channel, allowed: before.at === null },
    after: { channel, allowed },
  });
  await recordActivity(tx, {
    kind: "customer.contact_permission",
    subjectType: "customer",
    subjectId: customerId,
    summary: allowed
      ? `${label} turned back on`
      : `${label} stopped at customer’s request`,
    data: { channel, allowed },
  });
  return { id: customerId, changed: true };
}

// "How did they find you?" on the customer profile.
export async function setLeadSource(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    customerId: string;
    leadSource: LeadSource | null;
    detail: string | null;
  },
) {
  if (input.leadSource && !LEAD_SOURCE_KEYS.includes(input.leadSource))
    throw new AppError("VALIDATION", "Pick where they found you.");
  const detail = input.detail?.trim().slice(0, 200) || null;
  const [row] = await tx
    .update(customer)
    .set({ leadSource: input.leadSource, leadSourceDetail: detail })
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, input.customerId),
      ),
    )
    .returning({ id: customer.id });
  if (!row) throw notFound("That customer");
  await audit(tx, meta, {
    action: "customer.lead_source",
    targetType: "customer",
    targetId: row.id,
    after: { leadSource: input.leadSource, detail },
  });
  return { id: row.id };
}
