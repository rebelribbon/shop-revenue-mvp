"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { customer, estimateVersion, invoice, user } from "@/db/schema";
import { getJob, jobInput } from "@/domain/jobs";
import { moneyCategories, updateRecovery } from "@/domain/money-finder";
import { recordActivity } from "@/domain/records";
import { updateTask } from "@/domain/tasks";
import { AppError, notFound } from "@/lib/errors";
import {
  channelLabels,
  correspondenceChannels,
  correspondenceOutcomes,
  outcomeLabels,
  outcomesFor,
  requiresSummary,
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
    interactionId: z.uuid().optional(),
    task: z
      .object({
        target: z.discriminatedUnion("source", [
          z.object({ source: z.literal("manual"), id: z.uuid() }),
          z.object({
            source: z.literal("rule"),
            category: z.enum(moneyCategories),
            subjectId: z.uuid(),
          }),
        ]),
        update: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("complete") }),
          z.object({ kind: z.literal("note") }),
          z.object({ kind: z.literal("follow_up"), dueOn: z.iso.date() }),
        ]),
      })
      .optional(),
  }),
  async run({ tx, meta, session }, input) {
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
    if (!opened && requiresSummary(outcome) && !input.summary)
      throw new AppError(
        "VALIDATION",
        "Enter a short summary of what happened.",
      );
    let taskActivityId: string | undefined;
    if (input.task) {
      const { channel } = input;
      if (opened || (channel !== "text" && channel !== "email"))
        throw new AppError("VALIDATION", "Choose a text or email outcome.");
      const { target, update } = input.task;
      if (update.kind !== "note") {
        const followUpOn =
          update.kind === "follow_up" ? update.dueOn : undefined;
        const taskContact = {
          customerId: person.id,
          jobId,
          channel,
          followUpOn,
        };
        if (target.source === "manual") {
          await updateTask(tx, meta, {
            id: target.id,
            action: followUpOn ? "snooze" : "done",
            taskContact,
          });
        } else {
          const recovery = await updateRecovery(tx, meta, {
            category: target.category,
            subjectId: target.subjectId,
            action: followUpOn ? "snooze" : "contact",
            method: channel === "email" ? "email" : "other",
            taskContact,
          });
          taskActivityId = recovery.activityId;
        }
      }
    }
    const [staff] =
      !opened && session.userId
        ? await tx
            .select({ name: user.displayName })
            .from(user)
            .where(eq(user.id, session.userId))
        : [];
    const label = channelLabels[input.channel];
    const detail = opened ? undefined : input.summary;
    const result = opened
      ? input.channel === "other"
        ? "Sharing option used"
        : `${label} shortcut opened`
      : `${label} · ${outcomeLabels[outcome]}`;
    const summary = detail ? `${result} — ${detail}` : result;
    const characters = Array.from(summary);
    return await recordActivity(tx, {
      kind: opened ? "correspondence.opened" : "correspondence.logged",
      subjectType: "customer",
      subjectId: person.id,
      summary:
        characters.length > 280
          ? `${characters.slice(0, 279).join("")}…`
          : summary,
      data: {
        channel: input.channel,
        outcome: input.outcome,
        note: detail,
        jobId,
        documentId: input.documentId,
        interactionId: input.interactionId,
        loggedBy: staff?.name,
        taskUpdate: input.task?.update,
        taskTarget:
          input.task?.update.kind !== "note" ? input.task?.target : undefined,
        taskActivityId,
      },
    }).then((event) => ({ id: event.id }));
  },
});
