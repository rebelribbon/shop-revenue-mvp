"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type {
  InspectionItem,
  InspectionStatus,
  InspectionAssessment,
} from "@/lib/inspection-templates";
import { saveInspectionAction } from "@/server/actions/inspections";
import { useActionHydration } from "./action-hydration";
import { MediaUploader } from "./media-uploader";

const CONDITIONS: { value: InspectionStatus; label: string }[] = [
  { value: "good", label: "Pass" },
  { value: "watch", label: "Caution" },
  { value: "fix", label: "Fail" },
  { value: "na", label: "N/A" },
];
const conditionLabel = (status: InspectionStatus) =>
  CONDITIONS.find((c) => c.value === status)?.label ?? "Unchecked";
const needsFindings = (item: InspectionItem) =>
  item.status === "watch" || item.status === "fix";
const pointComplete = (item: InspectionItem) =>
  item.status !== "unchecked" &&
  (!needsFindings(item) || !!item.note.trim()) &&
  (item.status !== "fix" || !!item.recommendedWork?.trim());
const sectionName = (item: InspectionItem) => item.section || "Inspection";

export function InspectionForm({
  jobId,
  customerId,
  vehicleId,
  serviceAssetId,
  initial,
  readOnly,
  completed = false,
  initialAssessment,
  automotive = true,
}: {
  jobId: string;
  customerId: string;
  vehicleId?: string | null;
  serviceAssetId?: string | null;
  initial: InspectionItem[];
  readOnly: boolean;
  completed?: boolean;
  initialAssessment: InspectionAssessment;
  automo¶»§q«^