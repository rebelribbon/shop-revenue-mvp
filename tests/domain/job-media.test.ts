import { beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { runInContext, withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { freezeEstimate, readPublicEstimate } from "@/domain/estimates";
import { issueInvoice, readPublicInvoice } from "@/domain/invoices";
import {
  finishMediaUpload,
  listMedia,
  prepareMediaUpload,
  updateMedia,
} from "@/domain/job-media";
import { createJob, getJob } from "@/domain/jobs";
import { writeLocal } from "@/lib/media-storage";
import { hashToken } from "@/lib/tokens";
import { signTestEstimate } from "../helpers/authorization";
import { meta, seedTenant } from "../helpers/fixtures";

beforeAll(() => {
  process.env.MEDIA_STORAGE = "local";
  process.env.MEDIA_LOCAL_DIR = "/tmp/shop-revenue-test-media";
});

const keyOf = (uploadUrl: string) =>
  new URL(uploadUrl, "http://x").searchParams.get("key")!;
const publicKey = (token: string, fileId: string) =>
  runInContext(null, { type: "customer", id: null }, async (tx) => {
    const r = await tx.execute(
      sql`select app.public_media_key(${hashToken(token)}, ${fileId}::uuid) as key`,
    );
    return r.rows[0]?.key as string | null;
  });

it("uploads job photos; customers see only the ones switched on", async () => {
  const t = await seedTenant("Media");
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.businessId, t.owner.actor, fn);
  const c = await run((tx) =>
    createCustomer(tx, meta(), { firstName: "Photo", lastName: "TEST" }),
  );
  const v = await run((tx) =>
    createVehicle(tx, meta(), { customerId: c.id, make: "Ford" }),
  );
  const job = await run((tx) =>
    createJob(tx, {
      customerId: c.id,
      vehicleId: v.id,
      title: "Brakes",
      parts: [
        {
          description: "Pads",
          quantity: 1,
          unitCostCents: 1,
          unitPriceCents: 9000,
        },
      ],
      labor: [],
    }),
  );
  const add = async (tag: "issue" | "before" | "after", show: boolean) => {
    const prep = await run((tx) =>
      prepareMediaUpload(tx, {
        customerId: c.id,
        contentType: "image/jpeg",
        byteSize: 4,
      }),
    );
    // Finishing before the browser uploads is refused.
    if (tag === "issue")
      await expect(
        run((tx) =>
          finishMediaUpload(tx, meta(), {
            fileId: prep.fileId,
            customerId: c.id,
            tag,
          }),
        ),
      ).rejects.toThrow(/didn’t finish/);
    await writeLocal(keyOf(prep.uploadUrl), Buffer.from("jpeg"));
    await run((tx) =>
      finishMediaUpload(tx, meta(), {
        fileId: prep.fileId,
        customerId: c.id,
        jobId: job.id,
        tag,
        caption: `${tag} shot`,
        showCustomer: show,
      }),
    );
    return prep.fileId;
  };
  await expect(
    run((tx) =>
      prepareMediaUpload(tx, {
        customerId: c.id,
        contentType: "application/pdf",
        byteSize: 4,
      }),
    ),
  ).rejects.toThrow(/photo/);
  const shown = await add("issue", true);
  const hidden = await add("before", false);
  expect((await run((tx) => listMedia(tx, { jobId: job.id }))).length).toBe(2);

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
  const estToken = e.path.split("/").pop()!;
  const pub = await readPublicEstimate(estToken);
  expect(pub!.snapshot.photos?.map((p) => p.fileId)).toEqual([shown]);
  expect(await publicKey(estToken, shown)).toMatch(/job_media/);
  expect(await publicKey(estToken, hidden)).toBeNull();
  expect(await publicKey("x".repeat(43), shown)).toBeNull();

  await signTestEstimate(estToken, "P", ["part-0"], meta());
  const inv = await run((tx) =>
    issueInvoice(tx, meta(), { versionId: e.id, dueOn: null, terms: "" }),
  );
  const invToken = inv.path.split("/").pop()!;
  const after = await add("after", true);
  expect(
    (await readPublicInvoice(invToken))!.photos!.map((p) => p.fileId),
  ).toEqual([shown, after]);
  expect(await publicKey(invToken, hidden)).toBeNull();
  // Hiding or removing takes it off the invoice link right away.
  const [afterRow] = (
    await run((tx) => listMedia(tx, { jobId: job.id }))
  ).filter((m) => m.fileId === after);
  await run((tx) => updateMedia(tx, { mediaId: afterRow.id, remove: true }));
  expect(await publicKey(invToken, after)).toBeNull();
  // Another shop can't see these files at all.
  const other = await seedTenant("Media other");
  expect(
    await withTenant(other.businessId, other.owner.actor, (tx) =>
      listMedia(tx, { customerId: c.id }),
    ),
  ).toEqual([]);
});
