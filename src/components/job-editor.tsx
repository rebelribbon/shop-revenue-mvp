"use client";
import { useActionHydration } from "./action-hydration";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAutomotive } from "@/lib/business-types";
import { createJobAction } from "@/server/actions/jobs";
import { saveCommonJobAction } from "@/server/actions/owner-tools";
import { calculateJob } from "@/domain/job-costing";
import type { JobInput } from "@/domain/jobs";
import type { CatalogPart } from "@/domain/parts";
import { CustomerPicker } from "./customer-picker";
import { RepeatPicker } from "./repeat-picker";
import { updateMediaAction } from "@/server/actions/job-media";
import type { Repeat } from "@/lib/service-plans";
export type JobOptions = {
  customers: { id: string; name: string }[];
  vehicles: {
    id: string;
    customerId: string;
    year: number | null;
    make: string | null;
    model: string | null;
  }[];
  serviceAssets: { id: string; customerId: string; displayName: string }[];
};
export type CommonJobChoice = {
  id: string;
  name: string;
  parts: JobInput["parts"];
  labor: JobInput["labor"];
};
export const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
export function JobEditor({
  options,
  initial,
  recommendations = [],
  businessType = "automotive",
  partsTaxableDefault = true,
  laborTaxableDefault = false,
  laborSellRateCents = 0,
  laborCostRateCents = 0,
  commonJobs =¶»§q«^