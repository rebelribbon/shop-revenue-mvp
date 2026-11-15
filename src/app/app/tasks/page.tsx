import { ContactLaunchLink } from "@/components/correspondence";
import {
  outcomeLabels,
  type ContactTask,
  type CorrespondenceTarget,
  type SentSummary,
} from "@/lib/correspondence";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { TasksNavigation } from "@/components/tasks-navigation";
import { withTenant } from "@/db/tenant";
import { listCustomers } from "@/domain/customers";
import { canManageTeam } from "@/domain/membership";
import { listAdvisors } from "@/domain/assignments";
import { getBusinessProfile } from "@/domain/business-profile";
import { getJobFollowUp, listTasks, type TaskRow } from "@/domain/tasks";
import { isAutomotive } from "@/lib/business-types";
import { jobReference } from "@/lib/job-reference";
import { contactTaskLabels, type TaskAction } from "@/lib/task-action";
import { addLocalDays } from "@/lib/timezone";
import { updateRecoveryAction } from "@/server/actions/money-finder";
import {
  addJobFollowUpAction,
  addTaskAction,
  updateTaskAction,
} from "@/server/actions/tasks";
import { requireShopSession } from "@/server/views/shop";

const nice = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    da¶»§q«^