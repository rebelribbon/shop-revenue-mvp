"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JobInput } from "@/domain/jobs";
import { createJobAction } from "@/server/actions/jobs";
import { useActionHydration } from "./action-hydration";

type Part = JobInput["parts"][number];
type Labor = JobInput["labor"][number];
type Repair = {
  id: string;
  name: string;
  labor: Labor;
  parts: Part[];
};

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const cents = (value: string) => Math.round(Number(value || 0) * 100);
const amount = (value: number | null) =>
  value === null ? "" : String(value / 100);
const partPrefix = (name: string) => name.slice(0, 130) + " · ";

function fromJob(input: JobInput): Repair[] {
  const labor = input.labor.length ? input.labor : [];
  const repairs: Repair[] = labor.map((line, index) => ({
    id: "labor-" + index,
    name: line.description,
    labor: { ...line },
    parts: [],
  }));
  const ungrouped: Part[] = [];
  for (const part of input.parts) {
    const group = repairs.find((repair) =>
      part.description.startsWith(partPrefix(repair.name)),
    );
    if (group) {
      group.parts.push({
        ...part,
        description: part.description.slice(partPrefix(group.name).length),
      });
    } else {
      ungrouped.push(part);
    }
  }
  if (ungrouped.length) {
    if (repairs.length) repairs¶»§q«^