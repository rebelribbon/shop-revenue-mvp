"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { EstimateSnapshot } from "@/db/schema/m3";
import { estimateTotals } from "@/lib/estimate-tax";
import { EstimateDocument, formatMoney } from "./estimate-document";

type Event = {
  id: string;
  kind: "document.email_submitted" | "estimate.customer_opened";
  at: string;
  description: string;
};
type Auth = {
  signerName: string;
  createdAt: string;
  approvedLineIds: string[];
} | null;

const dateTime = (value: string, timeZone: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function AdvisorProposalTracking({
  jobId,
  version,
  snapshot,
  authorization,
  events,
  documents,
  customerPath,
  timeZone,
}: {
  jobId: string;
  version: number;
  snapshot: EstimateSnapshot;
  authorization: Auth;
  events: Event[];
  documents: ReactNode;
  customerPath?: string;
  timeZone: string;
}) {
  const [tab, setTab] = useState<"activity" | "decisions" | "documents">(
    "activity",
  );
  const [preview, setPreview] = useState(false);
  const opened = events.find((e) => e.kind === "estimate.customer_opened");
  const submitted = events.find((e) => e.kind === "document.email_submitted");
  const signed = Boolean(authorization);
  const ids = new Set(authorization?.approvedLineIds ?? []);
  const approved = snapshot.lines.filter((line) => ids.has(lin¶»§q«^