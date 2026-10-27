import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { describe, it, expect } from "vitest";
import {
  estimateVersion,
  invoiceCheckout,
  invoicePayment,
  stripeConnection,
} from "@/db/schema";
import { withTenant, runInContext } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { signEstimate } from "@/domain/estimates";
import {
  issueInvoice,
  listInvoices,
  recordInvoicePayment,
  reverseInvoicePayment,
  voidInvoice,
  readPublicInvoice,
  rotateInvoiceLink,
} from "@/domain/invoices";
import {
  reserveCheckout,
  resolveInvoicePaymentToken,
  settleCheckout,
  reserveRefund,
  settleRefund,
  withPaymentTenant,
  stripeBusiness,
} from "@/domain/payments";
import { newToken } from "@/lib/tokens";
import { meta, seedTenant } from "../helpers/fixtures";
async function fixture() {
  const t = await seedTenant("Stripe", { withStaff: true });
  const token = newToken();
  const c = await withTenant(t.businessId, t.owner.actor, (tx) =>
    createCustomer(tx, meta(), { firstName: "Card", lastName: "Customer" }),
  );
  const v = await withTenant(t.businessId, t.owner.actor, (tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const version = await withTenant(t.businessId, t.owner.actor, async (tx) => {
    const [e] = await tx
      .insert(estimateVersion)
      .values({
        businessId: t.businessId,
        customerId: c.id,
        vehicleId: v.id,
        quoteId: randomUUID(),
        version: 1,
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + 3600000),
        snapshot: {
          title: "Repair",
          shopName: "Shop",
          customerName: "Customer",
          vehicleLabel: "Ford",
          lines: [
            {
              id: "part-0",
              description: "Repair",
              kind: "part",
              quantity: 1,
              unitPriceCents: 10000,
              totalCents: 10000,
            },
          ],
          subtotalCents: 10000,
          taxBps: 0,
          taxCents: 0,
          totalCents: 10000,
          terms: "",
        },
      })
      .returning();
    return e;
  });
  await signEstimate(token.token, "Customer", ["part-0"], meta());
  const i = await withTenant(t.businessId, t.owner.actor, (tx) =>
    issueInvoice(tx, meta(), { versionId: version.id, dueOn: null, terms: "" }),
  );
  const accountId = `acct_${randomUUID()}`;
  await withTenant(t.businessId, t.owner.actor, (tx) =>
    tx
      .insert(stripeConnection)
      .values({
        businessId: t.businessId,
        accountId,
        cardPaymentsStatus: "active",
        livemode: false,
      }),
  );
  return { ...t, invoiceId: i.id, token: i.path.split("/").pop()!, accountId };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function reserve(f: F) {
  return withPaymentTenant(f.businessId, (tx) =>
    reserveCheckout(tx, f.invoiceId),
  );
}
function session(
  f: F,
  a: { id: string; amountCents: number },
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: `cs_test_${a.id}`,
    object: "checkout.session",
    mode: "payment",
    livemode: false,
    amount_total: a.amountCents,
    currency: "usd",
    status: "complete",
    payment_status: "paid",
    payment_intent: `pi_${a.id}`,
    metadata: {
      checkout_id: a.id,
      invoice_id: f.invoiceId,
      business_id: f.businessId,
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}
async function pay(f: F) {
  const a = await reserve(f);
  await withPaymentTenant(f.businessId, (tx) =>
    settleCheckout(tx, meta(), a.id, f.accountId, session(f, a)),
  );
  return (
    await withTenant(f.businessId, f.owner.actor, (tx) => listInvoices(tx))
  )[0].entries.find((p) => p.method === "stripe")!;
}
describe("online invoice payments", () => {
  it("resolves only valid current invoice tokens, keeps private account identifiers out of customer documents", async () => {
    const f = await fixture();
    expect(await resolveInvoicePaymentToken(f.token)).toEqual({
      businessId: f.businessId,
      invoiceId: f.invoiceId,
    });
    const dto = await readPublicInvoice(f.token);
    expect(dto?.onlinePaymentEnabled).toBe(true);
    expect(JSON.stringify(dto)).not.toContain(f.accountId);
    await withTenant(f.businessId, f.owner.actor, (tx) =>
      rotateInvoiceLink(tx, meta(), f.invoiceId),
    );
    await expect(resolveInvoicePaymentToken(f.token)).rejects.toThrow();
    await expect(resolveInvoicePaymentToken("invalid")).rejects.toThrow();
    const rows = await runInContext(null, { type: "support", id: null }, (tx) =>
      tx.execute(
        sql`select * from app.invoice_payment_context(${newToken().hash})`,
      ),
    );
    expect(rows.rows).toHaveLength(0);
  });
  it("reserves the remaining balance once under concurrent clicks and blocks conflicting money changes", async () => {
    const f = await fixture();
    await withTenant(f.businessId, f.owner.actor, (tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: f.invoiceId,
        amountCents: 2000,
        method: "cash",
        reference: "Deposit",
      }),
    );
    const attempts = await Promise.all([reserve(f), reserve(f)]);
    expect(attempts[0].id).toBe(attempts[1].id);
    expect(attempts[0].amountCents).toBe(8000);
    await expect(
      withTenant(f.businessId, f.owner.actor, (tx) =>
        recordInvoicePayment(tx, meta(), {
          invoiceId: f.invoiceId,
          amountCents: 100,
          method: "cash",
          reference: "Conflict",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(f.businessId, f.owner.actor, (tx) =>
        voidInvoice(tx, meta(), f.invoiceId, "Conflict"),
      ),
    ).rejects.toThrow();
  });
  it("never marks unpaid asynchronous payments paid; records final confirmation exactly once", async () => {
    const f = await fixture();
    const a = await reserve(f);
    await withPaymentTenant(f.businessId, (tx) =>
      settleCheckout(
        tx,
        meta(),
        a.id,
        f.accountId,
        session(f, a, { payment_status: "unpaid" }),
      ),
    );
    expect((await readPublicInvoice(f.token))?.paidCents).toBe(0);
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        withPaymentTenant(f.businessId, (tx) =>
          settleCheckout(tx, meta(), a.id, f.accountId, session(f, a)),
        ),
      ),
    );
    expect(outcomes.every((r) => r.paid)).toBe(true);
    expect((await readPublicInvoice(f.token))?.paidCents).toBe(10000);
    const [i] = await withTenant(f.businessId, f.owner.actor, (tx) =>
      listInvoices(tx),
    );
    expect(i.entries).toHaveLength(1);
    await expect(reserve(f)).rejects.toThrow(/already paid/);
    await expect(
      withTenant(f.businessId, f.owner.actor, (tx) =>
        reverseInvoicePayment(tx, meta(), i.entries[0].id, "Oops"),
      ),
    ).rejects.toThrow(/refund/);
  });
  it("rejects mismatched account, amount, currency, mode, session and tenant references", async () => {
    const f = await fixture();
    const a = await reserve(f);
    for (const mismatch of [
      { amount_total: 9999 },
      { currency: "eur" },
      { livemode: true },
      { mode: "setup" },
      {
        metadata: {
          checkout_id: a.id,
          invoice_id: randomUUID(),
          business_id: f.businessId,
        },
      },
    ] as Partial<Stripe.Checkout.Session>[]) {
      await expect(
        withPaymentTenant(f.businessId, (tx) =>
          settleCheckout(
            tx,
            meta(),
            a.id,
            f.accountId,
            session(f, a, mismatch),
          ),
        ),
      ).rejects.toThrow(/match/);
    }
    await expect(
      withPaymentTenant(f.businessId, (tx) =>
        settleCheckout(tx, meta(), a.id, "acct_other", session(f, a)),
      ),
    ).rejects.toThrow();
    expect((await readPublicInvoice(f.token))?.paidCents).toBe(0);
  });
  it("releases an expired checkout only after provider confirmation; a new attempt gets a new identity", async () => {
    const f = await fixture();
    const a = await reserve(f);
    await withPaymentTenant(f.businessId, (tx) =>
      settleCheckout(
        tx,
        meta(),
        a.id,
        f.accountId,
        session(f, a, { status: "expired", payment_status: "unpaid" }),
      ),
    );
    const next = await reserve(f);
    expect(next.id).not.toBe(a.id);
  });
  it("cannot route another tenant's account or forge provider entries as shop staff or support", async () => {
    const f = await fixture();
    const b = await seedTenant("Other payment tenant");
    expect(await stripeBusiness(f.accountId)).toBe(f.businessId);
    expect(
      await withTenant(b.businessId, b.owner.actor, (tx) =>
        tx.select().from(invoiceCheckout),
      ),
    ).toEqual([]);
    await expect(
      withTenant(f.businessId, f.staff!.actor, (tx) =>
        tx.insert(stripeConnection).values({ businessId: f.businessId }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(f.businessId, f.owner.actor, (tx) =>
        tx
          .insert(invoiceCheckout)
          .values({
            businessId: f.businessId,
            invoiceId: f.invoiceId,
            accountId: f.accountId,
            amountCents: 10000,
            expiresAt: new Date(),
          }),
      ),
    ).rejects.toThrow();
    const a = await reserve(f);
    await expect(
      withTenant(f.businessId, f.owner.actor, (tx) =>
        tx
          .insert(invoicePayment)
          .values({
            businessId: f.businessId,
            invoiceId: f.invoiceId,
            amountCents: 10000,
            method: "stripe",
            stripeAccountId: f.accountId,
            stripePaymentIntentId: "pi_fake",
            checkoutId: a.id,
          }),
      ),
    ).rejects.toThrow();
  });
});
describe("Stripe refunds", () => {
  it("requires owner, caps cumulative requests, preserves pending balance and imports success once", async () => {
    const f = await fixture();
    const p = await pay(f);
    const request = {
      paymentId: p.id,
      amountCents: 3000,
      reason: "Partial refund",
      requestId: randomUUID(),
    };
    await expect(
      withTenant(f.businessId, f.staff!.actor, (tx) =>
        reserveRefund(tx, meta(), request),
      ),
    ).rejects.toThrow();
    const reserved = await withTenant(f.businessId, f.owner.actor, (tx) =>
      reserveRefund(tx, meta(), request),
    );
    expect(
      (
        await withTenant(f.businessId, f.owner.actor, (tx) =>
          reserveRefund(tx, meta(), request),
        )
      ).refund.id,
    ).toBe(reserved.refund.id);
    await expect(
      withTenant(f.businessId, f.owner.actor, (tx) =>
        reserveRefund(tx, meta(), {
          ...request,
          amountCents: 8000,
          requestId: randomUUID(),
        }),
      ),
    ).rejects.toThrow(/exceeds/);
    expect((await readPublicInvoice(f.token))?.paidCents).toBe(10000);
    const refund = {
      id: `re_${randomUUID()}`,
      payment_intent: p.stripePaymentIntentId,
      currency: "usd",
      amount: 3000,
      status: "pending",
      metadata: { refund_request_id: request.requestId },
    } as unknown as Stripe.Refund;
    await withPaymentTenant(f.businessId, (tx) =>
      settleRefund(tx, meta(), f.accountId, refund),
    );
    expect((await readPublicInvoice(f.token))?.paidCents).toBe(10000);
    await Promise.all(
      [1, 2].map(() =>
        withPaymentTenant(f.businessId, (tx) =>
          settleRefund(tx, meta(), f.accountId, {
            ...refund,
            status: "succeeded",
          }),
        ),
      ),
    );
    expect((await readPublicInvoice(f.token))?.paidCents).toBe(7000);
    expect((await reserve(f)).amountCents).toBe(3000);
  });
  it("records Stripe Dashboard refunds and never creates a negative balance beyond the original payment", async () => {
    const f = await fixture();
    const p = await pay(f);
    const refund = {
      id: `re_${randomUUID()}`,
      payment_intent: p.stripePaymentIntentId,
      currency: "usd",
      amount: 10000,
      status: "succeeded",
      metadata: {},
    } as unknown as Stripe.Refund;
    expect(
      await withPaymentTenant(f.businessId, (tx) =>
        settleRefund(tx, meta(), f.accountId, refund),
      ),
    ).toBe(true);
    await expect(
      withPaymentTenant(f.businessId, (tx) =>
        settleRefund(tx, meta(), f.accountId, {
          ...refund,
          id: `re_${randomUUID()}`,
          amount: 1,
        }),
      ),
    ).rejects.toThrow();
    expect((await readPublicInvoice(f.token))?.paidCents).toBe(0);
  });
  it("failed refunds leave money unchanged and free the refund reservation", async () => {
    const f = await fixture();
    const p = await pay(f);
    const request = {
      paymentId: p.id,
      amountCents: 10000,
      reason: "Refund",
      requestId: randomUUID(),
    };
    await withTenant(f.businessId, f.owner.actor, (tx) =>
      reserveRefund(tx, meta(), request),
    );
    await withPaymentTenant(f.businessId, (tx) =>
      settleRefund(tx, meta(), f.accountId, {
        id: `re_${randomUUID()}`,
        payment_intent: p.stripePaymentIntentId,
        currency: "usd",
        amount: 10000,
        status: "failed",
        metadata: { refund_request_id: request.requestId },
      } as unknown as Stripe.Refund),
    );
    expect((await readPublicInvoice(f.token))?.paidCents).toBe(10000);
    await expect(
      withTenant(f.businessId, f.owner.actor, (tx) =>
        reserveRefund(tx, meta(), { ...request, requestId: randomUUID() }),
      ),
    ).resolves.toBeTruthy();
  });
});
