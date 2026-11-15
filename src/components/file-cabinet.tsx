"use client";

import { useEffect, useMemo, useState } from "react";
import type { CabinetItem } from "@/domain/documents";
import { prepareDocumentShare } from "@/server/actions/document-sharing";
import {
  removeDocumentAction,
  voidDocumentAction,
} from "@/server/actions/documents";
import { ActionForm } from "./action-form";
import { DocumentShare } from "./document-share";

type View = "all" | "generated" | "uploaded";

export function FileCabinet({
  items,
  readOnly,
  demoMode = false,
  autoOpenShare = false,
  timeZone,
}: {
  items: CabinetItem[];
  customerPhone: string | null;
  customerEmail: string | null;
  readOnly: boolean;
  demoMode?: boolean;
  autoOpenShare?: boolean;
  timeZone: string;
}) {
  // Never let the shop send an older frozen version while its RO has newer
  // unsent priced work. Finalize the current draft first.
  const hasNewerDraft = items.some(
    (item) => item.status === "Draft — not sent",
  );
  const estimate = hasNewerDraft
    ? undefined
    : items.find((item) => item.estimateShareId);
  const [view, setView] = useState<View>("all");
  const [activeId, setActiveId] = useState<string>(
    estimate?.id ?? items[0]?.id ?? "",
  );
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [shareOpen, setShareOpen] = useState(autoOpenShare);
  const [estimatePreview, setEstimatePreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const active = items.find((item) => ite¶»§q«^