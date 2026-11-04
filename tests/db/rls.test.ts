import { createCustomer } from "@/domain/customers";
import { addExpense } from "@/domain/owner-money";
import { saveCommonJob } from "@/domain/common-jobs";
import { testPolicySnapshot } from "../helpers/policy";
import { signTestEstimate as signEstimate } from "../helpers/authorization";
// RLS suite (Section 22): generated for every table with a business_id column,
// discovered from the catalog. Insert in A; B sees nothing, changes nothing and
// cannot write into A; a raw query without tenant context sees nothing.
import {
  estimateRecommendationLine,
  revenueAttribution,
  revenueAttributionEvent,
  invoiceCheckout,
  invoiceRefund,
  stripeConnection,
  shopSubscription,
  servicePlan,
  jobMedia,
  documentTemplate,
  task,
  registerClose,
  timeEntry,
  savedReport,
  inspection,
  jobAssignment,
  paymentReminder,
  reviewRequest,
  weeklyReport,
  counterSale,
  partItem,
  stockMove,
  customerPortal,
  document,
  estimateAuthorization,
  recommendation,
  recoveryItem,
} from "@/db/schema";
import { issueInvoice, recordInvoicePayment } from "@/domain/invoices";
import { newToken } from "@/lib/tokens";

import { estimateVersion } from "@/db/schema";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { withAdmin } from "@/db/admin";
import {
  assetReading,
  note,
  appointment,
  customer,
  file,
  location,
  membership,
  requestIdempotency,
  supportSession,
  vehicle,
} from "@/db/schema";
import { ingestWebhookEvent, withTenant, type Actor } from "@/db/tenant";
import { audit, recordActivity } from "@/domain/records";
import { eq, sql } from "drizzle-orm";
import {
  findRlsViolations,
  findTenantFkViolations,
} from "../../scripts/db/check-rls";
import {
  clientOf,
  createInternalUser,
  meta,
  rawClient,
  seedTenant,
  type SeededTenant,
} from "../helpers/fixtures";

let A: SeededTenant;
let B: SeededTenant;
let adminId: string;

beforeAll(async () => {
  A = await seedTenant("Alpha");
  B = await seedTenant("Bravo");
  adminId = (await createInternalUser("admin")).id;
});

type Builder = (t: SeededTenant) => Promise<string>;
async function estimateFixture(t: SeededTenant) {
  const vehicleId = await builders["app.vehicle"](t);
  const token = newToken();
  const id = await withTenant(t.businessId, t.owner.actor, async (tx) => {
    const [v] = await tx
      .select()
      .from(vehicle)
      .where(eq(vehicle.id, vehicleId));
    const [e] = await tx
      .insert(estimateVersion)
      .values({
        businessId: t.businessId,
        quoteId: randomUUID(),
        version: 1,
        customerId: v.customerId,
        vehicleId,
        snapshot: {
          authorizationPolicy: await testPolicySnapshot(),
          title: "Test",
          shopName: "Shop",
          customerName: "Customer",
          vehicleLabel: "Vehicle",
          lines: [
            {
              id: "part-0",
              description: "Fixture",
              quantity: 1,
              unitPriceCents: 1000,
              totalCents: 1000,
              kind: "part",
            },
          ],
          subtotalCents: 1000,
          taxBps: 0,
          taxCents: 0,
          totalCents: 1000,
          terms: "",
        },
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();
    return e.id;
  });
  return { id, token: token.token };
}
async function invoiceFixture(t: SeededTenant) {
  const e = await estimateFixture(t);
  await signEstimate(e.token, "Fixture", ["part-0"], meta());
  return withTenant(t.businessId, t.owner.actor, (tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
  );
}
const builders: Record<string, Builder> = {
  "app.expense": async (t) =>
    withTenant(
      t.businessId,
      t.owner.actor,
      async (tx) =>
        (
          await addExpense(tx, meta(), {
            spentOn: "2026-10-31",
            description: "RLS rent",
            category: "rent",
            amountCents: 10000,
            includedInJobCost: false,
          })
        ).id,
    ),
  "app.common_job": async (t) =>
    withTenant(
      t.businessId,
      t.owner.actor,
      async (tx) =>
        (
          await saveCommonJob(tx, meta(), {
            name: "RLS brakes",
            parts: [
              {
                description: "Pads",
                quantity: 1,
                unitCostCents: 100,
                unitPriceCents: 200,
              },
            ],
            labor: [],
          })
        ).id,
    ),
  "app.estimate_recommendation_line": async (t) => {
    const e = await estimateFixture(t);
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [v] = await tx
        .select()
        .from(estimateVersion)
        .where(eq(estimateVersion.id, e.id));
      const [rec] = await tx
        .insert(recommendation)
        .values({
          businessId: t.businessId,
          customerId: v.customerId,
          vehicleId: v.vehicleId,
          description: "Traced fixture",
        })
        .returning();
      const [row] = await tx
        .insert(estimateRecommendationLine)
        .values({
          businessId: t.businessId,
          versionId: e.id,
          lineId: "part-0",
          recommendationId: rec.id,
        })
        .returning();
      return row.id;
    });
  },
  "app.revenue_attribution": async (t) => {
    const i = await invoiceFixture(t);
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(revenueAttribution)
        .values({
          businessId: t.businessId,
          invoiceId: i.id,
          ruleVersion: "manual-v1",
          decision: {},
        })
        .returning();
      return row.id;
    });
  },
  "app.revenue_attribution_event": async (t) => {
    const id = await builders["app.revenue_attribution"](t);
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(revenueAttributionEvent)
        .values({
          businessId: t.businessId,
          attributionId: id,
          revision: 1,
          directDeltaCents: 0,
          influencedDeltaCents: 0,
          reason: "Isolation fixture",
          before: {},
          after: {},
          ruleVersion: "manual-v1",
        })
        .returning();
      return row.id;
    });
  },

  "app.recommendation": async (t) => {
    const vehicleId = await builders["app.vehicle"](t);
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [v] = await tx
        .select()
        .from(vehicle)
        .where(eq(vehicle.id, vehicleId));
      const [r] = await tx
        .insert(recommendation)
        .values({
          businessId: t.businessId,
          customerId: v.customerId,
          vehicleId,
          description: "Brake service",
          amountCents: 10000,
        })
        .returning();
      return r.id;
    });
  },
  "app.recovery_item": async (t) => {
    const vehicleId = await builders["app.vehicle"](t);
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [v] = await tx
        .select()
        .from(vehicle)
        .where(eq(vehicle.id, vehicleId));
      const [r] = await tx
        .insert(recoveryItem)
        .values({
          businessId: t.businessId,
          category: "service_due",
          subjectId: vehicleId,
          customerId: v.customerId,
          vehicleId,
        })
        .returning();
      return r.id;
    });
  },
  "app.stripe_connection": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(stripeConnection)
        .values({ businessId: t.businessId, accountId: `acct_${randomUUID()}` })
        .onConflictDoUpdate({
          target: stripeConnection.businessId,
          set: { cardPaymentsStatus: "active" },
        })
        .returning();
      return row.id;
    }),
  "app.customer_portal": async (t) => {
    const customerId = (
      await withTenant(t.businessId, t.owner.actor, (tx) =>
        createCustomer(tx, meta(), { firstName: "RLS", lastName: "Portal" }),
      )
    ).id;
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(customerPortal)
        .values({
          businessId: t.businessId,
          customerId,
          tokenHash: "a".repeat(64),
          shareTokenCiphertext: "x",
        })
        .returning();
      return row.id;
    });
  },
  "app.job_assignment": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(jobAssignment)
        .values({
          businessId: t.businessId,
          jobId: randomUUID(),
          userId: t.owner.userId,
        })
        .returning();
      return row.id;
    }),
  "app.part_item": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(partItem)
        .values({
          businessId: t.businessId,
          name: "RLS part",
          unitPriceCents: 1,
        })
        .returning();
      return row.id;
    }),
  "app.stock_move": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [part] = await tx
        .insert(partItem)
        .values({
          businessId: t.businessId,
          name: "RLS move",
          unitPriceCents: 1,
        })
        .returning();
      const [row] = await tx
        .insert(stockMove)
        .values({
          businessId: t.businessId,
          partItemId: part.id,
          changeHundredths: 100,
          reason: "received",
        })
        .returning();
      return row.id;
    }),
  "app.payment_reminder": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(paymentReminder)
        .values({
          businessId: t.businessId,
          invoiceId: randomUUID(),
          sentTo: "rls@example.test",
          status: "sent",
          automatic: false,
        })
        .returning();
      return row.id;
    }),
  "app.review_request": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(reviewRequest)
        .values({
          businessId: t.businessId,
          customerId: randomUUID(),
          sentTo: "rls@example.test",
          status: "sent",
          automatic: false,
        })
        .returning();
      return row.id;
    }),
  "app.weekly_report": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(weeklyReport)
        .values({
          businessId: t.businessId,
          weekStart: "2030-01-07",
          sentTo: "rls@example.test",
          status: "sent",
          automatic: false,
        })
        .returning();
      return row.id;
    }),
  "app.counter_sale": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(counterSale)
        .values({
          businessId: t.businessId,
          number: 1,
          lines: [
            {
              description: "RLS",
              quantityHundredths: 100,
              unitPriceCents: 100,
            },
          ],
          subtotalCents: 100,
          taxBps: 0,
          taxCents: 0,
          totalCents: 100,
          method: "cash",
        })
        .returning();
      return row.id;
    }),
  "app.inspection": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(inspection)
        .values({ businessId: t.businessId, jobId: randomUUID(), items: [] })
        .returning();
      return row.id;
    }),
  "app.saved_report": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(savedReport)
        .values({ businessId: t.businessId, name: "RLS", config: {} })
        .returning();
      return row.id;
    }),
  "app.time_entry": async (t) => {
    const customerId = (
      await withTenant(t.businessId, t.owner.actor, (tx) =>
        createCustomer(tx, meta(), { firstName: "RLS", lastName: "Clock" }),
      )
    ).id;
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(timeEntry)
        .values({
          businessId: t.businessId,
          jobId: customerId,
          userId: t.owner.actor.id!,
          startedAt: new Date(Date.now() - 3600000),
          endedAt: new Date(Date.now() - 1800000),
        })
        .returning();
      return row.id;
    });
  },
  "app.register_close": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(registerClose)
        .values({
          businessId: t.businessId,
          day: "2026-11-03",
          startingCashCents: 0,
          expectedCashCents: 0,
          countedCashCents: 0,
          takenCents: 0,
        })
        .returning();
      return row.id;
    }),
  "app.task": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(task)
        .values({ businessId: t.businessId, title: "RLS", dueOn: "2026-11-03" })
        .returning();
      return row.id;
    }),
  "app.document_template": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(documentTemplate)
        .values({ businessId: t.businessId, name: "RLS", body: "Body" })
        .returning();
      return row.id;
    }),
  "app.document": async (t) => {
    const customerId = (
      await withTenant(t.businessId, t.owner.actor, (tx) =>
        createCustomer(tx, meta(), { firstName: "RLS", lastName: "Doc" }),
      )
    ).id;
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const id = randomUUID();
      await tx.insert(file).values({
        id,
        businessId: t.businessId,
        storageKey: `b/${t.businessId}/document/${id}.pdf`,
        kind: "document",
        contentType: "application/pdf",
        byteSize: 4,
        status: "ready",
      });
      const [row] = await tx
        .insert(document)
        .values({
          businessId: t.businessId,
          customerId,
          kind: "upload",
          category: "other",
          title: "RLS",
          fileId: id,
        })
        .returning();
      return row.id;
    });
  },
  "app.job_media": async (t) => {
    const customerId = (
      await withTenant(t.businessId, t.owner.actor, (tx) =>
        createCustomer(tx, meta(), { firstName: "RLS", lastName: "Media" }),
      )
    ).id;
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const id = randomUUID();
      await tx.insert(file).values({
        id,
        businessId: t.businessId,
        storageKey: `b/${t.businessId}/job_media/${id}.jpg`,
        kind: "job_media",
        contentType: "image/jpeg",
        byteSize: 4,
        status: "ready",
      });
      const [row] = await tx
        .insert(jobMedia)
        .values({
          businessId: t.businessId,
          customerId,
          fileId: id,
          mediaType: "photo",
          tag: "before",
        })
        .returning();
      return row.id;
    });
  },
  "app.service_plan": async (t) => {
    const e = await estimateFixture(t);
    await signEstimate(e.token, "Fixture", ["part-0"], meta());
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [v] = await tx
        .select()
        .from(estimateVersion)
        .where(eq(estimateVersion.id, e.id));
      const [a] = await tx
        .select()
        .from(estimateAuthorization)
        .where(eq(estimateAuthorization.versionId, e.id));
      const [row] = await tx
        .insert(servicePlan)
        .values({
          businessId: t.businessId,
          customerId: v.customerId,
          vehicleId: v.vehicleId,
          quoteId: v.quoteId,
          versionId: v.id,
          authorizationId: a.id,
          title: "RLS plan",
          repeat: {
            every: "week",
            startOn: "2026-11-03",
            until: { kind: "stopped" },
            billing: "per_visit",
          },
          perVisitCents: 1000,
          billing: "per_visit",
        })
        .returning();
      return row.id;
    });
  },
  "app.shop_subscription": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [existing] = await tx
        .select({ id: shopSubscription.id })
        .from(shopSubscription)
        .where(eq(shopSubscription.businessId, t.businessId));
      if (existing) return existing.id;
      const [row] = await tx
        .insert(shopSubscription)
        .values({ businessId: t.businessId })
        .returning();
      return row.id;
    }),
  "app.invoice_checkout": async (t) => {
    const i = await invoiceFixture(t);
    return withTenant(
      t.businessId,
      { type: "system", id: null },
      async (tx) => {
        const [row] = await tx
          .insert(invoiceCheckout)
          .values({
            businessId: t.businessId,
            invoiceId: i.id,
            accountId: `acct_${randomUUID()}`,
            amountCents: 1000,
            expiresAt: new Date(Date.now() + 3600000),
          })
          .returning();
        return row.id;
      },
    );
  },
  "app.invoice_refund": async (t) => {
    const i = await invoiceFixture(t);
    const p = await withTenant(t.businessId, t.owner.actor, (tx) =>
      recordInvoicePayment(tx, meta(), {
        invoiceId: i.id,
        amountCents: 500,
        method: "cash",
        reference: "fixture",
      }),
    );
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [row] = await tx
        .insert(invoiceRefund)
        .values({
          businessId: t.businessId,
          invoiceId: i.id,
          paymentId: p.id,
          amountCents: 100,
          reason: "Fixture",
        })
        .returning();
      return row.id;
    });
  },
  "app.invoice": async (t) => (await invoiceFixture(t)).id,
  "app.invoice_payment": async (t) => {
    const i = await invoiceFixture(t);
    return (
      await withTenant(t.businessId, t.owner.actor, (tx) =>
        recordInvoicePayment(tx, meta(), {
          invoiceId: i.id,
          amountCents: 500,
          method: "cash",
          reference: "fixture",
        }),
      )
    ).id;
  },
  "app.estimate_version": async (t) => (await estimateFixture(t)).id,
  "app.estimate_authorization": async (t) => {
    const f = await estimateFixture(t);
    await signEstimate(f.token, "Fixture", [], meta());
    return withTenant(
      t.businessId,
      t.owner.actor,
      async (tx) =>
        (
          await clientOf(tx).query(
            "SELECT id FROM app.estimate_authorization WHERE version_id=$1",
            [f.id],
          )
        ).rows[0].id,
    );
  },
  "app.asset": async (t) => builders["app.vehicle"](t),
  "app.asset_reading": async (t) => {
    const id = await builders["app.vehicle"](t);
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [r] = await tx
        .insert(assetReading)
        .values({ businessId: t.businessId, assetId: id, value: 100 })
        .returning();
      return r.id;
    });
  },
  "app.note": async (t) => {
    const id = await builders["app.customer"](t);
    return withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [r] = await tx
        .insert(note)
        .values({ businessId: t.businessId, customerId: id, body: "RLS note" })
        .returning();
      return r.id;
    });
  },
  "app.location": async (t) =>
    (
      await withAdmin({ internalUserId: adminId }, async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.business_id', ${t.businessId}, true)`,
        );
        const [r] = await tx
          .insert(location)
          .values({ businessId: t.businessId, name: "Second bay" })
          .returning();
        return r;
      })
    ).id,
  "app.membership": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [r] = await tx
        .insert(membership)
        .values({
          businessId: t.businessId,
          role: "staff",
          status: "invited",
          inviteEmail: `x${randomUUID()}@example.test`,
        })
        .returning();
      await tx
        .update(membership)
        .set({ status: "removed" })
        .where(eq(membership.id, r.id));
      return r.id;
    }),
  "app.customer": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [r] = await tx
        .insert(customer)
        .values({
          businessId: t.businessId,
          createdByUserId: t.owner.userId,
          firstName: "RLS",
          lastName: "Customer",
          displayName: `RLS Customer ${randomUUID()}`,
        })
        .returning();
      return r.id;
    }),
  "app.vehicle": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [c] = await tx
        .insert(customer)
        .values({
          businessId: t.businessId,
          createdByUserId: t.owner.userId,
          firstName: "Vehicle",
          lastName: "Owner",
          displayName: `Vehicle Owner ${randomUUID()}`,
        })
        .returning();
      const plate = `T${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
      const [r] = await tx
        .insert(vehicle)
        .values({
          businessId: t.businessId,
          createdByUserId: t.owner.userId,
          customerId: c.id,
          year: 2024,
          make: "BMW",
          model: "X5",
          plate,
          plateNormalized: plate,
        })
        .returning();
      return r.id;
    }),
  "app.appointment": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [c] = await tx
        .insert(customer)
        .values({
          businessId: t.businessId,
          createdByUserId: t.owner.userId,
          firstName: "Appointment",
          lastName: "Customer",
          displayName: `Appointment Customer ${randomUUID()}`,
        })
        .returning();
      const [r] = await tx
        .insert(appointment)
        .values({
          businessId: t.businessId,
          createdByUserId: t.owner.userId,
          customerId: c.id,
          startsAt: new Date(Date.now() + 86400000),
          reason: "RLS fixture",
        })
        .returning();
      return r.id;
    }),
  "app.activity": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const id = randomUUID();
      await recordActivity(tx, {
        kind: "test.created",
        subjectType: "test",
        subjectId: id,
        summary: "rls fixture",
      });
      return (
        await clientOf(tx).query(
          "SELECT id FROM app.activity WHERE subject_id = $1",
          [id],
        )
      ).rows[0].id;
    }),
  "app.audit_event": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const id = randomUUID();
      await audit(tx, meta(), {
        action: "test.fixture",
        targetType: "test",
        targetId: id,
      });
      return (
        await clientOf(tx).query(
          "SELECT id FROM app.audit_event WHERE target_id = $1",
          [id],
        )
      ).rows[0].id;
    }),
  "app.request_idempotency": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const [r] = await tx
        .insert(requestIdempotency)
        .values({
          businessId: t.businessId,
          clientRequestId: randomUUID(),
          action: "test",
          responseJson: { ok: true },
        })
        .returning();
      return r.id;
    }),
  "app.file": async (t) =>
    withTenant(t.businessId, t.owner.actor, async (tx) => {
      const id = randomUUID();
      const [r] = await tx
        .insert(file)
        .values({
          id,
          businessId: t.businessId,
          storageKey: `b/${t.businessId}/logo/2026/10/${id}.png`,
          kind: "logo",
          contentType: "image/png",
          byteSize: 10,
        })
        .returning();
      return r.id;
    }),
  "app.support_session": async (t) =>
    (
      await withAdmin({ internalUserId: adminId }, async (tx) => {
        const [r] = await tx
          .insert(supportSession)
          .values({
            adminUserId: adminId,
            adminDisplayName: "Fixture",
            businessId: t.businessId,
            reason: "RLS fixture session",
            expiresAt: new Date(),
          })
          .returning();
        return r;
      })
    ).id,
  "app.webhook_event": async (t) => {
    const { eventId } = await ingestWebhookEvent({
      provider: "stripe",
      providerEventId: `evt_${randomUUID()}`,
      eventType: "test.fixture",
      payload: { fixture: true },
    });
    const w = await rawClient("worker");
    await w.query(
      "UPDATE app.webhook_event SET business_id = $1 WHERE id = $2",
      [t.businessId, eventId],
    );
    await w.end();
    return eventId;
  },
};

async function tenantTables(): Promise<string[]> {
  const c = await rawClient("migration");
  const { rows } = await c.query(`
    SELECT n.nspname || '.' || c.relname AS t
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = 'app'
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped)
     ORDER BY 1`);
  await c.end();
  return rows.map((r) => r.t);
}

const ROLES = ["app", "worker", "admin"] as const;
const GLOBAL_READERS: Record<string, string[]> = {
  "app.support_session": ["worker", "admin"],
  "app.webhook_event": ["worker", "admin"],
};
const pgCode = (e: unknown) =>
  (e as { code?: string }).code ??
  (e as { cause?: { code?: string } }).cause?.code;
const roleOpt = (r: (typeof ROLES)[number]) => ({ role: r });
const actorFor = (r: (typeof ROLES)[number], t: SeededTenant): Actor =>
  r === "app"
    ? t.owner.actor
    : r === "worker"
      ? { type: "system", id: null }
      : { type: "internal", id: adminId };

async function countAs(
  role: (typeof ROLES)[number],
  ctx: SeededTenant,
  table: string,
  where: string,
  params: unknown[],
) {
  try {
    return await withTenant(
      ctx.businessId,
      actorFor(role, ctx),
      async (tx) => {
        const { rows } = await clientOf(tx).query(
          `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
          params,
        );
        return rows[0].n as number;
      },
      roleOpt(role),
    );
  } catch (e) {
    if ((e as { code?: string }).code === "42501") return 0;
    throw e;
  }
}

describe("RLS presence check (CI rule)", () => {
  it("passes on the migrated schema", async () => {
    const c = await rawClient("migration");
    expect(await findRlsViolations(c)).toEqual([]);
    await c.end();
  });
  it("fails when a migration adds a tenant table without RLS", async () => {
    const c = await rawClient("migration");
    await c.query("BEGIN");
    try {
      await c.query(
        "CREATE TABLE app.bad_tenant_table (id uuid PRIMARY KEY, business_id uuid NOT NULL)",
      );
      await c.query("CREATE SCHEMA scratch_ci");
      await c.query(
        "CREATE TABLE scratch_ci.bad_other_schema (id uuid PRIMARY KEY, business_id uuid NOT NULL)",
      );
      await c.query(
        "CREATE TABLE app.half_done (id uuid PRIMARY KEY, business_id uuid NOT NULL)",
      );
      await c.query("ALTER TABLE app.half_done ENABLE ROW LEVEL SECURITY");
      await c.query("ALTER TABLE app.half_done FORCE ROW LEVEL SECURITY");
      expect(await findRlsViolations(c)).toEqual(
        expect.arrayContaining([
          {
            table: "app.bad_tenant_table",
            problems: [
              "RLS not enabled",
              "RLS not forced",
              "no permissive policy",
            ],
          },
          {
            table: "scratch_ci.bad_other_schema",
            problems: [
              "RLS not enabled",
              "RLS not forced",
              "no permissive policy",
            ],
          },
          { table: "app.half_done", problems: ["no permissive policy"] },
        ]),
      );
    } finally {
      await c.query("ROLLBACK");
      await c.end();
    }
  });
});

describe("composite tenant foreign key check (CI rule)", () => {
  it("passes on the migrated schema", async () => {
    const c = await rawClient("migration");
    expect(await findTenantFkViolations(c)).toEqual([]);
    await c.end();
  });
  it("fails on a tenant-to-tenant reference that omits business_id", async () => {
    const c = await rawClient("migration");
    await c.query("BEGIN");
    try {
      await c.query(
        `CREATE TABLE app.loose_ref (id uuid PRIMARY KEY, business_id uuid NOT NULL, location_id uuid CONSTRAINT loose_ref_location_fk REFERENCES app.location (id))`,
      );
      expect(await findTenantFkViolations(c)).toEqual([
        {
          constraint: "loose_ref_location_fk",
          table: "app.loose_ref",
          references: "app.location",
        },
      ]);
      await c.query(
        `ALTER TABLE app.loose_ref ADD CONSTRAINT loose_ref_location_tenant_fk FOREIGN KEY (business_id, location_id) REFERENCES app.location (business_id, id)`,
      );
      expect(await findTenantFkViolations(c)).toEqual([]);
    } finally {
      await c.query("ROLLBACK");
      await c.end();
    }
  });
});

describe("generated tenant isolation for every business_id table", async () => {
  const tables = await tenantTables();
  it("has a fixture builder for every tenant table (add one when adding a table)", () =>
    expect(tables.filter((t) => !builders[t])).toEqual([]));
  for (const table of tables) {
    describe(table, () => {
      let rowId: string;
      beforeAll(async () => {
        rowId = await builders[table](A);
      });
      it("owner tenant can see its own row", async () => {
        const visible = await Promise.all(
          ROLES.map((r) => countAs(r, A, table, "id = $1", [rowId])),
        );
        expect(Math.max(...visible)).toBe(1);
      });
      for (const role of ROLES) {
        const globalReader = GLOBAL_READERS[table]?.includes(role);
        it(
          globalReader
            ? `${role}_user reads this global table across tenants by design (spec issue 2)`
            : `${role}_user in tenant B sees zero rows, even with WHERE business_id = A`,
          async () => {
            const expected = globalReader ? 1 : 0;
            expect(await countAs(role, B, table, "id = $1", [rowId])).toBe(
              expected,
            );
            expect(
              await countAs(role, B, table, "business_id = $1 AND id = $2", [
                A.businessId,
                rowId,
              ]),
            ).toBe(expected);
          },
        );
        it(`${role}_user in tenant B cannot update or delete A's row`, async () => {
          const r = await withTenant(
            B.businessId,
            actorFor(role, B),
            async (tx) => {
              const out: number[] = [];
              for (const stmt of [
                `UPDATE ${table} SET updated_at = updated_at WHERE id = $1`,
                `DELETE FROM ${table} WHERE id = $1`,
              ]) {
                await clientOf(tx).query("SAVEPOINT s");
                try {
                  out.push(
                    (await clientOf(tx).query(stmt, [rowId])).rowCount ?? 0,
                  );
                  await clientOf(tx).query("RELEASE SAVEPOINT s");
                } catch {
                  await clientOf(tx).query("ROLLBACK TO SAVEPOINT s");
                  out.push(0);
                }
              }
              return out;
            },
            roleOpt(role),
          );
          expect(r).toEqual([0, 0]);
          expect(
            (await countAs("app", A, table, "id = $1", [rowId])) +
              (await countAs("admin", A, table, "id = $1", [rowId])) +
              (await countAs("worker", A, table, "id = $1", [rowId])),
          ).toBeGreaterThan(0);
        });
      }
      it("raw queries without tenant context return zero rows for every role", async () => {
        for (const role of ["app", "worker", "admin"] as const) {
          const c = await rawClient(role);
          try {
            const { rows } = await c.query(
              `SELECT count(*)::int AS n FROM ${table} WHERE business_id IS NOT NULL`,
            );
            if (GLOBAL_READERS[table]?.includes(role))
              expect(rows[0].n).toBeGreaterThan(0);
            else expect(rows[0].n).toBe(0);
          } catch (e) {
            expect((e as { code?: string }).code).toBe("42501");
          } finally {
            await c.end();
          }
        }
      });
    });
  }
});

describe("cross-tenant writes are rejected", () => {
  it("app_user in B cannot insert a row claiming A's business_id", async () => {
    await expect(
      withTenant(B.businessId, B.owner.actor, (tx) =>
        tx.insert(requestIdempotency).values({
          businessId: A.businessId,
          clientRequestId: randomUUID(),
          action: "x",
          responseJson: {},
        }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "42501" }),
    });
  });
  it("app_user in B cannot audit into A", async () => {
    await expect(
      withTenant(B.businessId, B.owner.actor, (tx) =>
        clientOf(tx).query(
          "INSERT INTO app.audit_event (business_id, actor_type, action, target_type, request_id) VALUES ($1, 'user', 'x.y', 't', 'r')",
          [A.businessId],
        ),
      ).catch((e) => Promise.reject(pgCode(e))),
    ).rejects.toBe("42501");
  });
  it("a business row is visible only to its own tenant", async () => {
    const c = await rawClient("app");
    expect(
      (await c.query("SELECT count(*)::int n FROM app.business")).rows[0].n,
    ).toBe(0);
    await c.end();
    const seen = await withTenant(B.businessId, B.owner.actor, async (tx) =>
      (await clientOf(tx).query("SELECT id FROM app.business")).rows.map(
        (r) => r.id,
      ),
    );
    expect(seen).toEqual([B.businessId]);
  });
  it("users of A are invisible from B", async () => {
    const seen = await withTenant(B.businessId, B.owner.actor, async (tx) =>
      (await clientOf(tx).query('SELECT id FROM app."user"')).rows.map(
        (r) => r.id,
      ),
    );
    expect(seen).toEqual([B.owner.userId]);
  });
  it("webhook_event and internal_user are not readable by app_user at all", async () => {
    const c = await rawClient("app");
    for (const t of ["app.webhook_event", "app.internal_user"])
      await expect(c.query(`SELECT 1 FROM ${t}`)).rejects.toMatchObject({
        code: "42501",
      });
    await c.end();
  });
  it("a worker job for A carrying B's business_id is refused at enqueue", async () => {
    await expect(
      withTenant(
        A.businessId,
        { type: "system", id: null },
        (tx) =>
          clientOf(tx).query(
            "SELECT app.enqueue_job('heartbeat', jsonb_build_object('business_id', $1::text))",
            [B.businessId],
          ),
        { role: "worker" },
      ),
    ).rejects.toThrow(/TENANT_MISMATCH/);
  });
  it("the shop reads only its own support sessions", async () => {
    const ids = await withTenant(
      B.businessId,
      B.owner.actor,
      async (tx) =>
        (
          await clientOf(tx).query(
            "SELECT business_id FROM app.support_session",
          )
        ).rows,
    );
    expect(ids.every((r) => r.business_id === B.businessId)).toBe(true);
  });
});
