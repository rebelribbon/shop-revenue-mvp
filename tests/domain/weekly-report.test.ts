import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordInvoicePayment } from "@/domain/invoices";
import { savePart } from "@/domain/parts";
import {
  composeWeekly,
  lastWeekStart,
  prepareWeeklyNow,
  runWeeklyReports,
  saveWeeklySettings,
  sendPreparedWeekly,
  weeklyNumbers,
} from "@/domain/weekly-report";
import { localDateKey, localDateTimeToUtc } from "@/lib/timezone";
import {
  MemoryEmailProvider,
  setEmailProviderForTests,
} from "@/providers/email";
import { unpaidInvoice } from "../helpers/invoices";
import { meta } from "../helpers/fixtures";

const mail = new MemoryEmailProvider();
beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.EMAIL_FROM_ADDRESS = "test@example.test";
  setEmailProviderForTests(mail);
});
afterAll(() => setEmailProviderForTests(null));

const TZ = "America/Chicago";
const mailTo = (to: string) =>
  mail.sent.filter((m) => m.to === to && m.metadata?.kind === "weekly_report");

describe("Monday summary", () => {
  it("covers the Monday-to-Sunday week before today", () => {
    expect(lastWeekStart("2026-11-09")).toBe("2026-11-02"); // Monday
    expect(lastWeekStart("2026-11-11")).toBe("2026-11-02"); // Wednesday
    expect(lastWeekStart("2026-11-08")).toBe("2026-10-26"); // Sunday
  });

  it("adds up last week and what needs attention now", async () => {
    const f = await unpaidInvoice(null, null);
    await f.run((tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: f.invoiceId,
        amountCents: 5000,
        method: "cash",
        reference: "",
      }),
    );
    await f.run((tx) =>
      savePart(tx, meta(), {
        name: "Wiper blades TEST",
        unitPriceCents: 2000,
        reorderAtHundredths: 200,
        startingHundredths: 100,
      }),
    );
    // Treat this week as "last week" by looking from next Monday.
    const thisMonday = lastWeekStart(
      localDateKey(new Date(Date.now() + 7 * 86400000), TZ),
    );
    const n = await f.run((tx) => weeklyNumbers(tx, thisMonday, TZ));
    expect(n).toMatchObject({
      collectedCents: 5000,
      payments: 1,
      invoicedCents: 12000,
      invoices: 1,
      unpaidCents: 7000,
      unpaidCount: 1,
      newCustomers: 1,
      lowStock: ["Wiper blades TEST"],
    });
    const email = composeWeekly(n, "Test Auto", "http://localhost:3000");
    expect(email.subject).toBe(
      "Test Auto last week: $50 collected, $70 unpaid",
    );
    expect(email.text).toContain("Running low: Wiper blades TEST");
    expect(email.text).toContain("Open your shop: http://localhost:3000/app");
    // No app address configured: the summary still goes out, without a link.
    expect(composeWeekly(n, "Test Auto", null).text).not.toContain(
      "Open your shop",
    );
  });

  it("emails owners once a week, Monday to Wednesday, unless turned off", async () => {
    const f = await unpaidInvoice(null, null);
    const to = f.t.owner.email;
    const monday = localDateTimeToUtc("2030-01-07T08:00", TZ);
    const thursday = localDateTimeToUtc("2030-01-10T08:00", TZ);
    await runWeeklyReports(thursday);
    expect(mailTo(to)).toHaveLength(0); // not on a Thursday
    await runWeeklyReports(monday);
    expect(mailTo(to)).toHaveLength(1);
    await runWeeklyReports(monday);
    expect(mailTo(to)).toHaveLength(1); // once a week

    await f.run((tx) => saveWeeklySettings(tx, meta(), { on: false }));
    await runWeeklyReports(localDateTimeToUtc("2030-01-14T08:00", TZ));
    expect(mailTo(to)).toHaveLength(1);

    // By hand, any day.
    const p = await f.run((tx) => prepareWeeklyNow(tx));
    const r = await sendPreparedWeekly(f.t.businessId, f.t.owner.actor, p);
    expect(r.message).toBe(`Summary emailed to ${to}.`);
    expect(mailTo(to)).toHaveLength(2);
  }, 120_000);
});
