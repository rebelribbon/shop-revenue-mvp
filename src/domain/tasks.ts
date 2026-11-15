// Tasks: everyone the shop needs to reach, in one list. Two sources:
// reminders made by the shop's follow-up rules (recovery_item state), and
// tasks the shop writes itself (app.task).
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { business, customer, task } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import {
  outcomeLabels,
  type CallTaskOutcome,
  type TaskContact,
} from "@/lib/correspondence";
import { AppError, notFound } from "@/lib/errors";
import { readFollowUpRules, type FollowUpRules } from "@/lib/follow-up-rules";
import {
  CONTACT_TASK_KINDS,
  contactKindForTitle,
  contactTaskAction,
  contactTaskLabels,
  type ContactKind,
  type TaskAction,
} from "@/lib/task-action";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import {
  categoryLabels,
  followUpDueOn,
  listFollowUpItems,
  type MoneyCategory,
} from "./money-finder";
import { getJob, jobInput } from "./jobs";
import { audit, recordActivity, type RequestMeta } from "./records";
import { todayAgenda } from "./today";
import { currentMemberRole, canManageTeam, assertManager } from "./membership";
import { listAdvisors } from "./assignments";
import { getCustomerWithVehicles } from "./customers";
import { listMyJobHandoffs, type JobHandoff } from "./job-handoffs";

export type TaskRow = {
  key: string;
  source: "rule" | "manual" | "work";
  category: MoneyCategory | "manual" | "work";
  // The step this task asks for, separate from its related ¶»§q«^