"use client";

import { smsDraftHref } from "@/lib/sms-draft";
import { useActionHydration } from "./action-hydration";

export function TextDraftLink({
  phone,
  label,
  message,
  approvalPath,
}: {
  phone: string;
  label: string;
  message: string;
  approvalPath?: string;
}) {
  const ready = useActionHydration();
  const link =
    ready && approvalPath
      ? new URL(approvalPath, window.location.origin).href
      : null;
  const body = [message, link, "\nReply STOP to opt out."]
    .filter(Boolean)
    .join("\n");
  return (
    <a
      className="btn secondary"
      data-ux-ready={ready}
      href={ready ? smsDraftHref(phone, body) : undefined}
    >
      {label}
    </a>
  );
}
