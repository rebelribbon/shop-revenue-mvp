"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { customer, estimateVersion, invoice } from "@/db/schema";
import { getJob, jobInput } from "@/domain/jobs";
import { recordActivity } from "@/domain/records";
import { AppError, notFound } from "@/lib/errors";
import {
  channelLabels,
  correspondenceChannels,
  correspondenceOutcomes,
  outcomeLabels,
  outcomesFor,
} from "@/lib/correspondence";
import { defineShopAction } from "./define";

export const recordCorrespondenceAction = defineShopAction({
  name: "recordCorrespondence",
  input: z.object({
    customerId: z.uuid(),
    jobId: z.uuid().optional(),
    documentId: z.uuid().optional(),
    documentKind: z.enum(["estimate", "invoice"]).optional(),
    channel: z.enum(correspondenceChannels),
    outcome: z.enum(["opened", ...correspondenceOutcomes]),
    summary: z.string().trim().max(1000).optional(),
  }),
  async run({ tx }, input) {
    const [person] = await tx
      .select({ id: customer.id })
      .from(customer)
      .where(
        and(
          eq(customer.businessId, tx.businessId),
          eq(customer.id, input.customerId),
        ),
      );
    if (!person) throw notFound("That customer");
    if (Boolean(input.documentId) !== Boolean(input.documentKind))
      throw new AppError("VALIDATION", "Choose a customer document.");
    let jobId = input.jobId;
    if (input.documentId && input.documentKind) {
      const table =
        input.documentKind === "estimate" ? estimateVersion : invoice;
      const [document] = await tx
        .select({ jobId: table.quoteId })
        .from(table)
        .where(
          and(
            eq(table.businessId, tx.businessId),
            eq(table.id, input.documentId),
            eq(table.customerId, person.id),
          ),
        );
      if (!document) throw notFound("That customer document");
      jobId = document.jobId ?? undefined;
    } else if (jobId) {
      const job = await getJob(tx, jobId);
      const identity = jobInput.pick({ customerId: true }).safeParse(job?.data);
      if (!identity.success || identity.data.customerId !== person.id)
        throw notFound("That customer job");
    }

    const { outcome } = input;
    const opened = outcome === "opened";
    if (!opened && !outcomesFor(input.channel).includes(outcome))
      throw new AppError(
        "VALIDATION",
        "Choose an outcome for this contact method.",
      );
    if (!opened && input.outcome !== "no_answer" && !input.summary)
      throw new AppError(
        "VALIDATION",
        "Enter a short summary of what happened.",
      );
    const label = channelLabels[input.channel];
    const detail = opened ? undefined : input.summary;
    const result = opened
      ? input.channel === "other"
        ? "Sharing option used"
        : `${label} shortcut opened`
      : `${label} · ${outcomeLabels[outcome]}`;
    return await recordActivity(tx, {
      kind: opened ? "correspondence.opened" : "correspondence.logged",
      subjectType: "customer",
      subjectId: person.id,
      summary: detail ? `${result} — ${detail}` : result,
      data: {
        channel: input.channel,
        outcome: input.outcome,
        note: detail,
        jobId,
        documentId: input.documentId,
      },
    }).then((event) => ({ id: event.id }));
  },
});
