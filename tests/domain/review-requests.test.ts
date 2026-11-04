import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordInvoicePayment } from "@/domain/invoices";
import {
  lastReviewRequest,
  prepareReviewNow,
  runReviewRequests,
  saveReviewSettings,
  sendPreparedReview,
} from "@/domain/review-requests";
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

const LINK = "https://g.page/r/test-shop/review";
const mailTo = (to: string) => mail.sent.filter((m) => m.to === to);
const DAY = 86400000;

describe("Review requests", () => {
  it("needs a real link before it can be turned on", async () => {
    const f = await unpaidInvoice(null, null);
    await expect(
      f.run((tx) => saveReviewSettings(tx, meta(), { on: true, link: "" })),
    ).rejects.toThrow(/Add your review link/);
    await expect(
      f.run((tx) =>
        saveReviewSettings(tx, meta(), { on: false, link: "g.page/r/x" }),
      ),
    ).rejects.toThrow(/https:\/\//);
    await expect(
      f.run((tx) => prepareReviewNow(tx, { invoiceId: f.invoiceId })),
    ).rejects.toThrow(/Add your review link/);
  });

  it("asks once after the invoice is paid in full, not again for 6 months", async () => {
    const to = `review-${Date.now()}@example.test`;
    const f = await unpaidInvoice(to, null);
    await f.run((tx) =>
      saveReviewSettings(tx, meta(), { on: true, link: LINK }),
    );
    // Partly paid: no ask yet.
    await f.run((tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: f.invoiceId,
        amountCents: 5000,
        method: "cash",
        reference: "",
      }),
    );
    await runReviewRequests();
    expect(mailTo(to)).toHaveLength(0);
    await f.run((tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: f.invoiceId,
        amountCents: 7000,
        method: "cash",
        reference: "",
      }),
    );
    await runReviewRequests();
    const [ask] = mailTo(to);
    expect(ask.subject).toBe("How did we do, Remy?");
    expect(ask.text).toContain(LINK);
    await runReviewRequests(new Date(Date.now() + DAY));
    expect(mailTo(to)).toHaveLength(1);
    expect(
      (await f.run((tx) => lastReviewRequest(tx, f.customerId)))?.automatic,
    ).toBe(true);

    // By hand: blocked for a few weeks after the last ask.
    await expect(
      f.run((tx) => prepareReviewNow(tx, { customerId: f.customerId })),
    ).rejects.toThrow(/Give it a few weeks/);
  });

  it("asks by hand from checkout", async () => {
    const to = `ask-${Date.now()}@example.test`;
    const f = await unpaidInvoice(to, null);
    await f.run((tx) =>
      saveReviewSettings(tx, meta(), { on: false, link: LINK }),
    );
    const p = await f.run((tx) =>
      prepareReviewNow(tx, { invoiceId: f.invoiceId }),
    );
    const r = await sendPreparedReview(f.t.businessId, f.t.owner.actor, p);
    expect(r.message).toBe(`Review request emailed to ${to}.`);
    expect(mailTo(to)).toHaveLength(1);
    // Automatic is off: the daily job leaves this shop alone.
    await runReviewRequests();
    expect(mailTo(to)).toHaveLength(1);
  });
});
