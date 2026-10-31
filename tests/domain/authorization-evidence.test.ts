import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { withTenant, runInContext } from "@/db/tenant";
import { withAdmin } from "@/db/admin";
import { business, estimateAuthorization, estimateVersion } from "@/db/schema";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob, listJobs } from "@/domain/jobs";
import {
  freezeEstimate,
  readPublicEstimate,
  readPublicAuthorizationPdf,
  signEstimate,
} from "@/domain/estimates";
import { issueInvoice, readPublicInvoice } from "@/domain/invoices";
import {
  createPolicyDraft,
  approvePolicy,
  retirePolicy,
} from "@/domain/legal-policy";
import { updateBusinessProfile } from "@/domain/business-profile";
import { checkPublicThrottle } from "@/domain/public-throttle";
import { estimateTotals } from "@/lib/estimate-tax";
import { hashToken } from "@/lib/tokens";
import { meta, seedTenant, createInternalUser } from "../helpers/fixtures";
const signature = [
  [
    { x: 0.1, y: 0.2 },
    { x: 0.4, y: 0.6 },
  ],
];
async function fixture(label: string) {
  const t = await seedTenant(label);
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "José", lastName: "Evidence" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Honda" }),
  );
  const j = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brake repair",
      parts: [
        {
          description: "Pads",
          quantity: 1,
          unitCostCents: 10000,
          unitPriceCents: 20000,
        },
      ],
      labor: [
        {
          description: "Repair labor",
          estimatedHoursHundredths: 100,
          actualHoursHundredths: null,
          sellRateCents: 10000,
          costRateCents: 5000,
        },
      ],
    }),
  );
  const [saved] = await run((tx) => listJobs(tx));
  const input = {
    jobId: j.id,
    expectedJobVersion: saved.version,
    taxBps: 825,
    terms: "Exact frozen terms",
    supplementReason: "",
  };
  return { t, run, input };
}
it("rejects incomplete/duplicate/unknown decisions and archives exact immutable evidence and PDF", async () => {
  const f = await fixture("Explicit evidence");
  const e = await f.run((tx) => freezeEstimate(tx, meta(), f.input));
  const token = e.path.split("/").pop()!;
  const choices = [
    { id: "part-0", decision: "approve" as const },
    { id: "labor-0", decision: "decline" as const },
  ];
  await expect(
    signEstimate(token, "José", choices.slice(0, 1), meta(), signature),
  ).rejects.toThrow();
  await expect(
    signEstimate(token, "José", [choices[0], choices[0]], meta(), signature),
  ).rejects.toThrow();
  await expect(
    signEstimate(token, "José", choices, meta(), []),
  ).rejects.toThrow();
  // The database rejects partial decisions too, even when the action is bypassed.
  const visible = (await readPublicEstimate(token))!;
  await expect(
    runInContext(null, { type: "customer", id: null }, (tx) =>
      tx.execute(
        sql`select app.authorize_estimate(${hashToken(token)},'Attacker',${JSON.stringify(choices.slice(0, 1))}::jsonb,null,'invalid','test',${JSON.stringify(signature)}::jsonb,${visible.estimateSha256},now(),'JVBERi0=')`,
      ),
    ),
  ).rejects.toThrow();
  const request = { ...meta(), userAgent: "Evidence browser/1.0" };
  await signEstimate(token, "José Evidence", choices, request, signature);
  const [a] = await f.run((tx) =>
    tx
      .select()
      .from(estimateAuthorization)
      .where(eq(estimateAuthorization.versionId, e.id)),
  );
  expect(a).toMatchObject({
    userAgent: request.userAgent,
    ip: request.ip,
    requestId: request.requestId,
    estimateSha256: visible.estimateSha256,
    lineDecisions: choices,
    signatureStrokes: signature,
    policyId: visible.snapshot.authorizationPolicy!.id,
    policyVersion: visible.snapshot.authorizationPolicy!.version,
    policySha256: visible.snapshot.authorizationPolicy!.bodySha256,
    consentText: visible.snapshot.authorizationPolicy!.body,
  });
  const pdf = Buffer.from((await readPublicAuthorizationPdf(token))!, "base64");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(createHash("sha256").update(pdf).digest("hex")).toBe(
    a.evidencePdfSha256,
  );
  expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
  expect(await readPublicAuthorizationPdf("x".repeat(43))).toBeNull();
  const other = await seedTenant("Evidence isolation");
  expect(
    await withTenant(other.businessId, other.owner.actor, (tx) =>
      tx
        .select()
        .from(estimateAuthorization)
        .where(eq(estimateAuthorization.versionId, e.id)),
    ),
  ).toEqual([]);
  await expect(
    f.run((tx) =>
      tx
        .update(estimateAuthorization)
        .set({ userAgent: "tampered" })
        .where(eq(estimateAuthorization.id, a.id)),
    ),
  ).rejects.toThrow();
  const issued = await f.run((tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
  );
  expect(
    (await readPublicInvoice(issued.path.split("/").pop()!))?.totalCents,
  ).toBe(21650);
});
it("gates publication and unsigned customer rendering on the actual approved policy", async () => {
  const f = await fixture("Policy gate");
  await withAdmin(null, (tx) =>
    tx
      .update(business)
      .set({ jurisdictionCode: "US-OK" })
      .where(eq(business.id, f.t.businessId)),
  );
  await expect(
    f.run((tx) => freezeEstimate(tx, meta(), f.input)),
  ).rejects.toThrow(/approved authorization policy/);
  const drafter = await createInternalUser("admin"),
    approver = await createInternalUser("admin");
  const p = await createPolicyDraft({ internalUserId: drafter.id }, meta(), {
    jurisdictionCode: "US-OK",
    kind: "estimate_authorization",
    body: "TEST ONLY: exact counsel-managed policy text",
  });
  await expect(
    f.run((tx) => freezeEstimate(tx, meta(), f.input)),
  ).rejects.toThrow();
  await approvePolicy({ internalUserId: approver.id }, meta(), {
    policyId: p.id,
    approvalReference: "TEST ONLY",
  });
  const e = await f.run((tx) => freezeEstimate(tx, meta(), f.input));
  const token = e.path.split("/").pop()!;
  expect(
    (await readPublicEstimate(token))?.snapshot.authorizationPolicy?.body,
  ).toBe(p.body);
  await retirePolicy({ internalUserId: approver.id }, meta(), p.id);
  expect(await readPublicEstimate(token)).toBeNull();
  await expect(
    signEstimate(
      token,
      "Customer",
      [
        { id: "part-0", decision: "approve" },
        { id: "labor-0", decision: "decline" },
      ],
      meta(),
      signature,
    ),
  ).rejects.toThrow();
});
it("uses line tax flags and owner defaults without altering frozen or legacy documents", async () => {
  const f = await fixture("Line tax");
  await f.run((tx) =>
    updateBusinessProfile(tx, meta(), {
      legalName: "Tax defaults",
      timezone: "America/Chicago",
      taxRateBps: 825,
      partsTaxableDefault: true,
      laborTaxableDefault: false,
    }),
  );
  const e = await f.run((tx) => freezeEstimate(tx, meta(), f.input));
  const token = e.path.split("/").pop()!;
  const visible = (await readPublicEstimate(token))!;
  expect(visible.snapshot).toMatchObject({
    subtotalCents: 30000,
    taxCents: 1650,
    totalCents: 31650,
  });
  expect(visible.snapshot.lines.map((l) => l.taxable)).toEqual([true, false]);
  await f.run((tx) =>
    updateBusinessProfile(tx, meta(), {
      legalName: "New defaults",
      timezone: "America/Chicago",
      taxRateBps: 500,
      partsTaxableDefault: false,
      laborTaxableDefault: true,
    }),
  );
  expect((await readPublicEstimate(token))!.snapshot).toEqual(visible.snapshot);
  expect(
    estimateTotals(
      visible.snapshot.lines.map((line) => ({ ...line, taxable: undefined })),
      825,
    ).totalCents,
  ).toBe(32475);
  expect(
    estimateTotals(
      [
        { ...visible.snapshot.lines[0], taxable: false },
        { ...visible.snapshot.lines[1], taxable: true },
      ],
      825,
    ).taxCents,
  ).toBe(825);
  expect(
    await f.run((tx) =>
      tx
        .select({ id: estimateVersion.id })
        .from(estimateVersion)
        .where(
          and(
            eq(estimateVersion.businessId, f.t.businessId),
            eq(estimateVersion.id, e.id),
          ),
        ),
    ),
  ).toHaveLength(1);
});
it("limits public signature attempts atomically without storing bearer links", async () => {
  process.env.SESSION_SIGNING_SECRET =
    "test-only-document-throttle-secret-at-least-32-characters";
  const token = crypto.randomUUID();
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      checkPublicThrottle("sign", token, crypto.randomUUID()),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
});
