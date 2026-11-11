"use server";
import { z } from "zod";
import {
  addJobFollowUp,
  addTask,
  saveFollowUpRules,
  updateTask,
} from "@/domain/tasks";
import { CONTACT_TASK_KINDS } from "@/lib/task-action";
import { callTaskOutcomes } from "@/lib/correspondence";
import { RULE_TEXT, type FollowUpRules } from "@/lib/follow-up-rules";
import { defineShopAction } from "./define";

export const addTaskAction = defineShopAction({
  name: "addTask",
  input: z.object({
    title: z.string().trim().min(1, "Write what to do.").max(200),
    dueOn: z.iso.date(),
    customerId: z.uuid().or(z.literal("")).optional(),
    jobId: z.uuid().optional(),
  }),
  run: ({ tx, meta }, i) =>
    addTask(tx, meta, {
      title: i.title,
      dueOn: i.dueOn,
      customerId: i.customerId || undefined,
      jobId: i.jobId,
    }),
  persist: (r) => ({ ...r, message: "Task added." }),
});

export const addJobFollowUpAction = defineShopAction({
  name: "addJobFollowUp",
  input: z.object({
    jobId: z.uuid(),
    method: z.enum(CONTACT_TASK_KINDS),
    dueOn: z.iso.date(),
  }),
  run: ({ tx, meta }, input) => addJobFollowUp(tx, meta, input),
});

export const updateTaskAction = defineShopAction({
  name: "updateTask",
  input: z.object({
    id: z.uuid(),
    action: z.enum(["done", "snooze", ...callTaskOutcomes]),
    days: z.enum(["1", "7"]).optional(),
    note: z.string().trim().max(300).optional(),
  }),
  run: ({ tx, meta }, i) =>
    updateTask(tx, meta, {
      id: i.id,
      action: i.action,
      days: i.days ? (Number(i.days) as 1 | 7) : undefined,
      note: i.note,
    }),
  persist: (r) => ({ ...r, message: "Task updated." }),
});

// Settings form: "<rule>_on" checkboxes and "<rule>_n" numbers.
const ruleFields = Object.fromEntries(
  RULE_TEXT.flatMap((r) => [
    [`${r.key}_on`, z.literal("on").optional()],
    [`${r.key}_n`, z.coerce.number().int().min(0).max(365)],
  ]),
);
export const saveFollowUpRulesAction = defineShopAction({
  name: "saveFollowUpRules",
  ownerOnly: true,
  input: z.object(ruleFields),
  run: ({ tx, meta }, i) => {
    const v = i as Record<string, unknown>;
    const rules = Object.fromEntries(
      RULE_TEXT.map((r) => [
        r.key,
        { on: v[`${r.key}_on`] === "on", [r.field]: Number(v[`${r.key}_n`]) },
      ]),
    ) as unknown as FollowUpRules;
    return saveFollowUpRules(tx, meta, rules);
  },
  persist: () => ({ message: "Follow-up rules saved." }),
});
