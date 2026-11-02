// Recurring work ("service plans"): pure schedule math and plain-English
// wording. Dates are shop-local calendar days (YYYY-MM-DD), never instants.
import { z } from "zod";

export const REPEAT_OPTIONS = [
  { value: "week", label: "Every week", unit: "week", count: 1 },
  { value: "2weeks", label: "Every 2 weeks", unit: "week", count: 2 },
  { value: "month", label: "Every month", unit: "month", count: 1 },
  { value: "3months", label: "Every 3 months", unit: "month", count: 3 },
  { value: "6months", label: "Every 6 months", unit: "month", count: 6 },
  { value: "year", label: "Every year", unit: "month", count: 12 },
] as const;
export type RepeatEvery = (typeof REPEAT_OPTIONS)[number]["value"];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
export const repeatInput = z.object({
  every: z.enum(REPEAT_OPTIONS.map((o) => o.value) as [RepeatEvery]),
  startOn: day,
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  until: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("stopped") }),
    z.object({ kind: z.literal("date"), on: day }),
    z.object({
      kind: z.literal("visits"),
      count: z.number().int().min(1).max(520),
    }),
  ]),
  billing: z.enum(["per_visit", "monthly"]),
});
export type Repeat = z.infer<typeof repeatInput>;

export const repeatOption = (every: RepeatEvery) =>
  REPEAT_OPTIONS.find((o) => o.value === every)!;

const parse = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
};
const fmt = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const daysInMonth = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();

// The nth visit date (0-based). Monthly plans keep the start day, clamped to
// short months (Jan 31 -> Feb 28 -> Mar 31).
export function visitDate(r: Pick<Repeat, "every" | "startOn">, n: number) {
  const o = repeatOption(r.every);
  const { y, m, d } = parse(r.startOn);
  if (o.unit === "week") return fmt(y, m, d + n * 7 * o.count);
  const total = m - 1 + n * o.count;
  const yy = y + Math.floor(total / 12),
    mm = (total % 12) + 1;
  return fmt(yy, mm, Math.min(d, daysInMonth(yy, mm)));
}

// Visit dates from the start up to and including `through`, honoring the end
// date or visit count. Returns [index, date] pairs.
export function visitsThrough(r: Repeat, through: string) {
  const out: { index: number; on: string }[] = [];
  const max =
    r.until.kind === "visits" ? r.until.count : Number.POSITIVE_INFINITY;
  for (let n = 0; n < max && n < 2000; n++) {
    const on = visitDate(r, n);
    if (on > through) break;
    if (r.until.kind === "date" && on > r.until.on) break;
    out.push({ index: n, on });
  }
  return out;
}

export function totalVisits(r: Repeat): number | null {
  if (r.until.kind === "visits") return r.until.count;
  if (r.until.kind === "date") return visitsThrough(r, r.until.on).length;
  return null;
}

// Average visits per month, used for "about $X a month" and recurring revenue.
export function visitsPerMonth(every: RepeatEvery) {
  const o = repeatOption(every);
  return o.unit === "week" ? 52 / 12 / o.count : 1 / o.count;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  });
const longDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const weekday = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
  });
const ordinal = (n: number) =>
  n +
  (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] ||
    ["th", "st", "nd", "rd"][n % 100] ||
    "th");
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "a.m." : "p.m."}`;
};

// "Every week on Tuesdays", "Every 3 months on the 15th".
export function cadenceText(r: Pick<Repeat, "every" | "startOn" | "time">) {
  const o = repeatOption(r.every);
  const on =
    o.unit === "week"
      ? `on ${weekday(r.startOn)}s`
      : `on the ${ordinal(parse(r.startOn).d)}`;
  return `${o.label} ${on}${r.time ? ` around ${clock(r.time)}` : ""}`;
}

export function untilText(r: Repeat) {
  return r.until.kind === "stopped"
    ? "until you or the shop stop it"
    : r.until.kind === "date"
      ? `until ${longDate(r.until.on)}`
      : `for ${r.until.count} visit${r.until.count === 1 ? "" : "s"}`;
}

export const billingText = (r: Pick<Repeat, "billing">) =>
  r.billing === "per_visit"
    ? "billed after each visit"
    : "billed once a month for that month’s visits";

// The plain-English terms the customer signs. Without an amount, the approved
// items on the estimate are the per-visit price.
export function repeatSummary(r: Repeat, perVisitCents?: number) {
  const price =
    perVisitCents === undefined
      ? "The items you approve are done and charged at every visit"
      : `${money(perVisitCents)} per visit`;
  return `${cadenceText(r)}, starting ${longDate(r.startOn)}, ${untilText(r)}. ${price}, ${billingText(r)}. You can stop future visits at any time.`;
}

// Owner-facing numbers: per month, per year, and for the whole plan.
export function repeatValue(r: Repeat, perVisitCents: number) {
  const monthly = Math.round(perVisitCents * visitsPerMonth(r.every));
  const visits = totalVisits(r);
  return {
    monthlyCents: monthly,
    yearlyCents: Math.round(perVisitCents * visitsPerMonth(r.every) * 12),
    totalCents: visits === null ? null : visits * perVisitCents,
    visits,
  };
}

export { money as formatPlanMoney, longDate as formatPlanDate };
