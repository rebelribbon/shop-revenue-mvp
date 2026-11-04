import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { customer, task } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  bookingSlug,
  readBooking,
  requestBooking,
  setBooking,
} from "@/domain/booking";
import { meta, seedTenant } from "../helpers/fixtures";

describe("Online booking", () => {
  it("turns a request into a new lead and a call-back task, only while the link is on", async () => {
    const t = await seedTenant("Booking");
    const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, t.owner.actor, fn);
    expect(await run((tx) => bookingSlug(tx))).toBeNull();
    const { slug } = await run((tx) => setBooking(tx, meta(), true));
    expect(slug).toMatch(/^[a-z0-9]{16}$/);
    expect((await readBooking(slug!))?.name).toBeTruthy();

    const r = await requestBooking(
      slug!,
      {
        firstName: "Jordan",
        lastName: "TEST Booker",
        phone: "(210) 831-2978",
        what: "2019 Ford F-150",
        service: "Brakes grinding",
        when: "Tuesday morning",
      },
      "203.0.113.9",
    );
    const [c] = await run((tx) =>
      tx
        .select()
        .from(customer)
        .where(
          and(eq(customer.businessId, t.businessId), eq(customer.id, r.id)),
        ),
    );
    // Tagged as an online-booking lead automatically.
    expect(c?.leadSource).toBe("booking");
    expect(c).toMatchObject({
      displayName: "Jordan TEST Booker",
      phoneE164: "+12108312978",
      notes: "Booked online: 2019 Ford F-150",
    });
    const tasks = await run((tx) =>
      tx.select().from(task).where(eq(task.customerId, r.id)),
    );
    expect(tasks[0].title).toBe(
      "Online booking: call Jordan TEST Booker about Brakes grinding (Tuesday morning)",
    );

    // Bad input and bad links are refused.
    await expect(
      requestBooking(
        slug!,
        { firstName: "X", lastName: "", phone: "12" },
        null,
      ),
    ).rejects.toThrow(/phone/i);
    expect(await readBooking("not-a-real-slug")).toBeNull();
    await run((tx) => setBooking(tx, meta(), false));
    expect(await readBooking(slug!)).toBeNull();
    await expect(
      requestBooking(
        slug!,
        { firstName: "A", lastName: "B", phone: "(210) 831-2978" },
        null,
      ),
    ).rejects.toThrow(/isn’t active/);
  });
});
