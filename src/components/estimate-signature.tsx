"use client";
import { useActionHydration } from "./action-hydration";
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { signEstimateAction } from "@/server/actions/estimates";
import type { EstimateSnapshot } from "@/db/schema/m3";
import type { LineDecision, SignatureStrokes } from "@/lib/estimate-decisions";
import { estimateTotals } from "@/lib/estimate-tax";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

const statusText = { fix: "Needs attention now", watch: "Service soon" };
const wheels = { lf: "LF", rf: "RF", lr: "LR", rr: "RR", spare: "Spare" };

// The customer's review, as the advisor presents it: (1) what they came in
// for, (2) the technician's inspection with photos and video, (3) the work
// the shop recommends, then (4) signing. Estimates with no inspection and no
// recommendations stay on one screen.
type Step = "request" | "inspection" | "recommended" | "sign";
const stepTitle: Record<Step, string> = {
  request: "What you came in for",
  inspection: "Inspection results",
  recommended: "Recommended work",
  sign: "Review and sign",
};

export function EstimateSignature({
  token,
  snapshot: s,
  media,
}: {
  token: string;
  snapshot: EstimateSnapshot;
  // Photos and video the shop chose to show, rendered by the page.
  media?: ReactNode;
}) {
  const requested = s.lines.filter((l) => !l.recommended);¶»§q«^