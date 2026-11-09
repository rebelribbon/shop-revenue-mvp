"use client";

import { ContactLaunchLink } from "./correspondence";
import type { CorrespondenceTarget } from "@/lib/correspondence";
import { smsDraftHref } from "@/lib/sms-draft";
import { useActionHydration } from "./action-hydration";

export function TextDraftLink({
  phone,
  target,
  label,
  message,
  approvalPath,
}: {
  phone: string;
  target?: CorrespondenceTarget;
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
    <ContactLaunchLink
      contact={target}
      channel="text"
      purpose={message}
      className="btn secondary"
      data-ux-ready={ready}
      href={ready ? smsDraftHref(phone, body) : undefined}
    >
      {label}
    </ContactLaunchLink>
  );
}
