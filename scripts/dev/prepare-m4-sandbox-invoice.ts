// One labeled, non-production invoice for real Stripe sandbox trials. Only its
// public-link hash is committed; the random bearer value stays outside git/logs.
import { and, eq, sql } from "drizzle-orm";
import {
  business,
  legalPolicy,
  estimateAuthorization,
  estimateVersion,
  invoice,
  stripeConnection,
} from "../../src/db/schema";
import { closePools, withTenant } from "../../src/db/tenant";
import { createCustomer, createVehicle } from "../../src/domain/customers";
import { rotateEstimateLink, signEstimate } from "../../src/domain/estimates";
import { issueInvoice } from "../../src/domain/invoices";
import { audit } from "../../src/domain/records";
import { newToken } from "../../src/lib/tokens";
import fixture from "./m4-sandbox-fixture.json";

const businessId = "01a1759e-9ea6-799a-b204-ce4be65f85fb";
const accountId = "acct_1UVJtq2fKiM8lfFO";
const title = "SANDBOX: Stripe payment and refund verification";
const meta = { requestId: "m4-sandbox-invoice-20261028", ip: "127.0.0.1" };
const system = { type: "system" as const, id: null };
const inShop = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(businessId, system, fn, { role: "app" });
let stage = "environment";

async function main() {
  const url = new URL(process.env.DATABASE_URL_WORKER ?? "");
  const appUrl = new URL(process.env.DATABASE_URL_APP ?? "");
  if (
    process.env.M4_SANDBOX_SETUP !== "true" ||
    process.env.APP_ENV === "production" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !==
      "https://gcclcuvdrqqllolxqhok.supabase.co" ||
    url.username !== "worker_user.gcclcuvdrqqllolxqhok" ||
    appUrl.username !== "app_user.gcclcuvdrqqllolxqhok" ||
    !/^[a-f0-9]{64}$/.test(fixture.invoiceTokenHash)
  )
    throw new Error("Refusing invoice fixture outside the expected preview");

  stage = "estimate";
  const version = await inShop(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${fixture.quoteId}, 0))`,
    );
    const [connection] = await tx
      .select()
      .from(stripeConnection)
      .where(eq(stripeConnection.businessId, businessId));
    if (
      connection?.accountId !== accountId ||
      connection.livemode ||
      connection.cardPaymentsStatus !== "active"
    )
      throw new Error("The authorized sandbox merchant must be active first");
    const [prior] = await tx
      .select()
      .from(estimateVersion)
      .where(
        and(
          eq(estimateVersion.businessId, businessId),
          eq(estimateVersion.quoteId, fixture.quoteId),
        ),
      );
    if (prior) {
      if (prior.snapshot.title !== title)
        throw new Error("Unexpected existing fixture estimate");
      const [signed] = await tx
        .select()
        .from(estimateAuthorization)
        .where(eq(estimateAuthorization.versionId, prior.id));
      if (signed) return { id: prior.id, token: null };
      const rotated = await rotateEstimateLink(tx, meta, prior.id);
      return { id: prior.id, token: rotated.path.split("/").pop()! };
    }
    const customer = await createCustomer(tx, meta, {
      firstName: "SANDBOX",
      lastName: "Payment verification",
      notes:
        "Synthetic customer for Stripe sandbox payment/refund tests. No real services or money.",
    });
    const vehicle = await createVehicle(tx, meta, {
      customerId: customer.id,
      make: "Sandbox",
      model: "Test vehicle",
      year: 2020,
    });
    const [shop] = await tx
      .select()
      .from(business)
      .where(eq(business.id, businessId));
    const [policy] = await tx
      .select()
      .from(legalPolicy)
      .where(
        and(
          eq(legalPolicy.jurisdictionCode, shop.jurisdictionCode),
          eq(legalPolicy.kind, "estimate_authorization"),
          eq(legalPolicy.status, "approved"),
        ),
      );
    if (!policy)
      throw new Error(
        "An approved authorization policy must be configured before sandbox estimates can be signed",
      );
    const token = newToken();
    const [row] = await tx
      .insert(estimateVersion)
      .values({
        businessId,
        customerId: customer.id,
        vehicleId: vehicle.id,
        quoteId: fixture.quoteId,
        version: 1,
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + 7 * 86400000),
        snapshot: {
          authorizationPolicy: {
            id: policy.id,
            version: policy.version,
            jurisdictionCode: policy.jurisdictionCode,
            body: policy.body,
            bodySha256: policy.bodySha256,
          },
          title,
          shopName: "Preview Shop LLC (sandbox)",
          customerName: "SANDBOX Payment verification",
          vehicleLabel: "2020 Sandbox Test vehicle",
          terms: "Sandbox simulation only; no actual repair authorization.",
          lines: [
            {
              id: "sandbox-part",
              kind: "part",
              description: "Test repair part",
              quantity: 1,
              unitPriceCents: 2500,
              totalCents: 2500,
            },
            {
              id: "sandbox-labor",
              kind: "labor",
              description: "Test repair labor",
              quantity: 1,
              unitPriceCents: 7500,
              totalCents: 7500,
            },
          ],
          subtotalCents: 10000,
          taxBps: 0,
          taxCents: 0,
          totalCents: 10000,
        },
      })
      .returning();
    await audit(tx, meta, {
      action: "estimate.sandbox_fixture_created",
      targetType: "estimate_version",
      targetId: row.id,
    });
    return { id: row.id, token: token.token };
  });

  stage = "authorization";
  if (version.token)
    await signEstimate(
      version.token,
      "Synthetic sandbox customer",
      [
        { id: "sandbox-part", decision: "approve" },
        { id: "sandbox-labor", decision: "approve" },
      ],
      meta,
      [
        [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.4 },
        ],
      ],
    );
  stage = "invoice";
  const result = await inShop(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"sandbox-invoice:" + fixture.quoteId}, 0))`,
    );
    let [row] = await tx
      .select()
      .from(invoice)
      .where(
        and(
          eq(invoice.businessId, businessId),
          eq(invoice.versionId, version.id),
        ),
      );
    if (!row) {
      const created = await issueInvoice(tx, meta, {
        versionId: version.id,
        dueOn: null,
        terms: "Sandbox test only; no real payment due.",
      });
      [row] = await tx.select().from(invoice).where(eq(invoice.id, created.id));
    }
    if (
      row.snapshot.title !== title ||
      row.totalCents !== 10000 ||
      row.voidedAt
    )
      throw new Error("Unexpected existing fixture invoice");
    if (row.tokenHash !== fixture.invoiceTokenHash) {
      await tx
        .update(invoice)
        .set({
          tokenHash: fixture.invoiceTokenHash,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        })
        .where(and(eq(invoice.id, row.id), eq(invoice.businessId, businessId)));
      await audit(tx, meta, {
        action: "invoice.sandbox_fixture_link_set",
        targetType: "invoice",
        targetId: row.id,
      });
    }
    return {
      sandboxInvoiceId: row.id,
      amountCents: row.totalCents,
      prepared: true,
    };
  });
  console.log(JSON.stringify(result));
}

try {
  await main();
} catch (error) {
  const cause =
    (error as { cause?: { code?: string }; code?: string })?.cause ??
    (error as { code?: string });
  const code =
    typeof cause?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(cause.code)
      ? cause.code
      : undefined;
  console.error(
    JSON.stringify({
      event: "m4.sandbox_invoice_failed",
      stage,
      code,
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await closePools();
}
