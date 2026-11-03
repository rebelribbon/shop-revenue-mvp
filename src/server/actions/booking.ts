"use server";
import { z } from "zod";
import { requestBooking, setBooking } from "@/domain/booking";
import { AppError } from "@/lib/errors";
import { getRequestMeta } from "../request";
import { defineShopAction } from "./define";

export const setBookingAction = defineShopAction({
  name: "setBooking",
  ownerOnly: true,
  input: z.object({ on: z.enum(["true", "false"]) }),
  run: ({ tx, meta }, i) => setBooking(tx, meta, i.on === "true"),
  persist: (r) => ({
    ...r,
    message: r.slug
      ? "Your booking link is ready."
      : "Booking link turned off.",
  }),
});

const bookingInput = z.object({
  slug: z.string().max(40),
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  phone: z.string().min(7, "Enter a phone number.").max(40),
  email: z.string().max(254).optional(),
  what: z.string().max(200).optional(),
  service: z.string().max(500).optional(),
  when: z.string().max(100).optional(),
});

// Public: no session. Throttled and limited to the shop's own booking link.
export async function requestBookingAction(raw: Record<string, unknown>) {
  try {
    const i = bookingInput.parse(raw);
    if (!(i.firstName.trim() || i.lastName.trim()))
      return { ok: false as const, error: { message: "Enter your name." } };
    const meta = await getRequestMeta();
    await requestBooking(i.slug, i, meta.ip ?? null);
    return { ok: true as const, data: { message: "Request sent." } };
  } catch (e) {
    if (e instanceof z.ZodError)
      return {
        ok: false as const,
        error: { message: e.issues[0]?.message ?? "Check the form." },
      };
    if (e instanceof AppError)
      return { ok: false as const, error: { message: e.message } };
    return {
      ok: false as const,
      error: { message: "Something went wrong. Please call the shop." },
    };
  }
}
