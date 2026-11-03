// Online booking: a public link a shop puts on its website and Google
// profile. A request becomes a new lead plus a "call them back" task.
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { runInContext, type TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { checkPublicThrottle } from "./public-throttle";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";

const SLUG = /^[a-z0-9]{12,32}$/;

export type PublicBooking = {
  name: string;
  businessType: string;
  phone: string | null;
  city: string | null;
};

export async function readBooking(slug: string): Promise<PublicBooking | null> {
  if (!SLUG.test(slug)) return null;
  return runInContext(null, { type: "customer", id: null }, async (tx) => {
    const r = await tx.execute(sql`select app.read_booking(${slug}) as data`);
    return (r.rows[0]?.data ?? null) as PublicBooking | null;
  });
}

export async function requestBooking(
  slug: string,
  input: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    what?: string;
    service?: string;
    when?: string;
  },
  ip: string | null,
) {
  if (!SLUG.test(slug))
    throw new AppError("NOT_FOUND", "This booking link isn’t active.");
  await checkPublicThrottle("sign", `booking:${slug}`, ip);
  const phone = normalizePhone(input.phone);
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  try {
    return await runInContext(
      null,
      { type: "customer", id: null },
      async (tx) => {
        const r = await tx.execute(
          sql`select app.request_booking(${slug},${input.firstName.trim()},${input.lastName.trim()},${phone},${email},${input.what?.trim() || null},${input.service?.trim() || null},${input.when?.trim() || null}) as id`,
        );
        return { id: String(r.rows[0].id) };
      },
    );
  } catch (e) {
    const msg = String(
      (e as { cause?: { message?: string } })?.cause?.message ??
        (e as Error).message,
    );
    if (msg.includes("booking unavailable"))
      throw new AppError("NOT_FOUND", "This booking link isn’t active.");
    if (msg.includes("INVALID_TRANSITION"))
      throw new AppError("VALIDATION", "Check your name and phone number.");
    throw e;
  }
}

export async function bookingSlug(tx: TenantTx) {
  const r = await tx.execute(
    sql`SELECT booking_slug FROM app.business WHERE id=${tx.businessId}`,
  );
  return (r.rows[0]?.booking_slug as string | null) ?? null;
}

export async function setBooking(tx: TenantTx, meta: RequestMeta, on: boolean) {
  await assertOwner(tx);
  const slug = on ? randomBytes(12).toString("hex").slice(0, 16) : null;
  await tx.execute(
    sql`UPDATE app.business SET booking_slug=${slug} WHERE id=${tx.businessId}`,
  );
  await audit(tx, meta, {
    action: on ? "booking.link_created" : "booking.link_turned_off",
    targetType: "business",
    targetId: tx.businessId,
    after: { on },
  });
  return { slug };
}
