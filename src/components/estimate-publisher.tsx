"use client";
import { useActionHydration } from "./action-hydration";
import Link from "next/link";
import { DocumentShare, type ShareData } from "./document-share";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  rotateEstimateLinkAction,
  freezeEstimateAction,
} from "@/server/actions/estimates";
export function EstimatePublisher({
  jobId,
  version,
  existingVersion,
  taxRateBps = 0,
  pendingChanges = false,
}: {
  jobId: string;
  version: string;
  existingVersion?: number;
  taxRateBps?: number;
  // The job changed since the latest estimate: show the resend form open.
  pendingChanges?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [path, setPath] = useState("");
  const [publishedId, setPublishedId] = useState("");
  const [share, setShare] = useState<ShareData | undefined>();
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const ready = useActionHydration();
  const router = useRouter();
  if (path || publishedId)
    return (
      <section data-ux-ready={ready}>
        <h4>Estimate saved — send it for authorization</h4>
        <p>
          Step 2 of 2: Confirm a customer email or phone number and send the
          secure approval link. The estimate is already in this job’s file
          cabinet.
        </p>
        {publishedId && (
          <DocumentShare
            id={publishedId}
            kind="estimate¶»§q«^