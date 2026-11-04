import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate } from "@/domain/estimates";
import { issueInvoice } from "@/domain/invoices";
import { createJob, getJob } from "@/domain/jobs";
import {
  isDue,
  prepareReminderNow,
  reminderHistory,
  runPaymentReminders,
  saveReminderSettings,
  sendPreparedReminder,
} from "@/domain/payment-reminders";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { customer } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  MemoryEmailProvider,
  setEmailProviderForTests,
} from "@/providers/email";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

const mail = new MemoryEmailProvider();
beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.EMAIL_FROM_ADDRESS = "test@example.test";
  setEmailProviderForTests(mail);
});
afterAll(() => setEmailProviderForTests(null));

const TZ = "America/Chicago";
const DAY = 86400000;

async function unpaidInvoice(email: string | null, dueOn: string | null) {
  const t = await seedTenant("Remind");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), {
      firstName: "Remy",
      lastName: "TEST",
      ...(email ? { email } : {}),
    }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brakes",
      parts: [],
      labor: [
        {
          description: "Labor",
          estimatedHoursHundredths: 100,
          actualHoursHundredths: null,
          sellRateCents: 12000,
          costRateCents: null,
        },
      ],
    }),
  );
  const saved = await run((tx) => getJob(tx, job.id));
  const e = await run((tx) =>
    freezeEstimate(tx, meta(), {
      jobId: job.id,
      expectedJobVersion: saved!.version,
      taxBps: 0,
      supplementReason: "",
      terms: "",
    }),
  );
  await signTestEstimate(e.path.split("/").pop()!, "S", ["labor-0"], meta());
  const inv = await run((tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn, terms: "" }),
  );
  return { t, run, customerId: c.id, invoiceId: inv.id };
}

const mailTo = (to: string) => mail.sent.filter((m) => m.to === to);

describe("Payment reminders", () => {
  it("waits until it's due, then repeats every few days up to the cap", () => {
    const settings = { on: true, everyDays: 3 };
    const base = {
      id: "x",
      number: 1,
      title: "",
      balanceCents: 100,
      dueOn: "2026-11-10",
      createdAt: new Date("2026-11-01T15:00:00Z"),
      expiresAt: new Date(),
      sealed: null,
      email: "a@example.test",
      optedOut: false,
      firstName: "A",
      sentCount: 0,
      lastSentAt: null,
    };
    expect(isDue(base, settings, "2026-11-09", TZ)).toBe(false);
    expect(isDue(base, settings, "2026-11-10", TZ)).toBe(true);
    const sent = {
      ...base,
      sentCount: 1,
      lastSentAt: new Date("2026-11-10T15:00:00Z"),
    };
    expect(isDue(sent, settings, "2026-11-12", TZ)).toBe(false);
    expect(isDue(sent, settings, "2026-11-13", TZ)).toBe(true);
    expect(isDue({ ...sent, sentCount: 5 }, settings, "2026-12-30", TZ)).toBe(
      false,
    );
    expect(isDue({ ...base, optedOut: true }, settings, "2026-11-20", TZ)).toBe(
      false,
    );
    expect(isDue({ ...base, email: null }, settings, "2026-11-20", TZ)).toBe(
      false,
    );
    // No due date: first one a few days after it was issued.
    const open = { ...base, dueOn: null };
    expect(isDue(open, settings, "2026-11-03", TZ)).toBe(false);
    expect(isDue(open, settings, "2026-11-04", TZ)).toBe(true);
  });

  it("emails the pay link once a day at most, only when the owner turned it on", async () => {
    const to = `remind-${Date.now()}@example.test`;
    const yesterday = addLocalDays(localDateKey(new Date(), TZ), -1);
    const f = await unpaidInvoice(to, yesterday);

    await runPaymentReminders();
    expect(mailTo(to)).toHaveLength(0); // off by default

    await f.run((tx) =>
      saveReminderSettings(tx, meta(), { on: true, everyDays: 3 }),
    );
    await runPaymentReminders();
    const [first] = mailTo(to);
    expect(first.subject).toMatch(/Reminder: .* invoice #\d+, \$120\.00 due/);
    expect(first.text).toMatch(
      /Pay online: http:\/\/localhost:3000\/invoice\//,
    );
    expect(first.replyTo).toBe(f.t.owner.email);

    await runPaymentReminders();
    expect(mailTo(to)).toHaveLength(1); // not again today
    await runPaymentReminders(new Date(Date.now() + 3 * DAY));
    expect(mailTo(to)).toHaveLength(2);

    const history = await f.run((tx) => reminderHistory(tx, f.invoiceId));
    expect(history.map((h) => [h.status, h.automatic])).toEqual([
      ["sent", true],
      ["sent", true],
    ]);

    // Opted out: skipped.
    await f.run((tx) =>
      tx
        .update(customer)
        .set({ emailOptedOutAt: new Date() })
        .where(
          and(
            eq(customer.businessId, f.t.businessId),
            eq(customer.id, f.customerId),
          ),
        ),
    );
    await runPaymentReminders(new Date(Date.now() + 6 * DAY));
    expect(mailTo(to)).toHaveLength(2);
    await expect(
      f.run((tx) => prepareReminderNow(tx, meta(), f.invoiceId)),
    ).rejects.toThrow(/asked not to get emails/);
  });

  it("sends one by hand, and explains when it can't", async () => {
    const to = `manual-${Date.now()}@example.test`;
    const f = await unpaidInvoice(to, null);
    const p = await f.run((tx) => prepareReminderNow(tx, meta(), f.invoiceId));
    const r = await sendPreparedReminder(f.t.businessId, f.t.owner.actor, p);
    expect(r.message).toBe(`Reminder emailed to ${to}.`);
    expect(mailTo(to)).toHaveLength(1);
    const [h] = await f.run((tx) => reminderHistory(tx, f.invoiceId));
    expect(h).toMatchObject({ status: "sent", automatic: false, sentTo: to });

    const noEmail = await unpaidInvoice(null, null);
    await expect(
      noEmail.run((tx) => prepareReminderNow(tx, meta(), noEmail.invoiceId)),
    ).rejects.toThrow(/Add the customer’s email/);
  });
});
