import { everyLabel, type Repeat } from "@/lib/service-plans";
import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { withTenant } from "@/db/tenant";
import { listTechs } from "@/domain/assignments";
import { assignVisitAction } from "@/server/actions/assignments";
import { headsUpNotes } from "@/domain/memory";
import { requireFrontOfficeView } from "@/server/views/shop";
import {
  listVisitsRange,
  listAppointmentChoices,
  visitStatusLabel,
} from "@/domain/appointments";
import { getBusinessProfile } from "@/domain/business-profile";
import { calendarDate } from "@/domain/owner-money";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { isAutomotive } from "@/lib/business-types";
import { VisitEditor } from "@/components/visit-editor";
import { ActionForm } from "@/components/action-form";
import {
  rescheduleAppointmentAction,
  setAppointmentStatusAction,
} from "@/server/actions/appointments";
export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    customerId?: string;
    vehicleId?: string;
    serviceAssetId?: string;
    sourceRecoveryItemId?: string;
    sourceContactActivityId?: string;
    week?: string;
    booked?: string;
  }>;
}) {
  const p = await searchParams,
    s = await requireFrontOfficeView("/app/schedule");
  const creating = p.new === "1" || !!p.customerId || !!p.sourceRecoveryItemId;
  const data = await withTenant(s.businessId¶»§q«^