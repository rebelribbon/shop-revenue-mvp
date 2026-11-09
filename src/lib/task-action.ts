export const CONTACT_TASK_KINDS = ["call", "text", "email"] as const;
export type ContactKind = (typeof CONTACT_TASK_KINDS)[number];
export const contactTaskLabels = { call: "Call", text: "Text", email: "Email" };

export type TaskAction = {
  kind: ContactKind | "work";
  label: string;
  href: string;
};

// Use the first instruction, never a name or contact detail typed in the title.
export function contactKindForTitle(title: string): ContactKind | undefined {
  const instruction = title.trim();
  if (/^(text|sms|send (a )?text)\b/i.test(instruction)) return "text";
  if (/^(call|phone|make (a )?call)\b/i.test(instruction)) return "call";
  if (/^(e-?mail|send (an? )?e-?mail)\b/i.test(instruction)) return "email";
}

export function contactTaskAction(
  kind: ContactKind,
  contact: {
    phone: string | null;
    email: string | null;
    textAllowed: boolean;
  },
): TaskAction | undefined {
  if (kind === "text" && contact.phone && contact.textAllowed)
    return { kind, label: "Text", href: `sms:${contact.phone}` };
  if (kind === "call" && contact.phone)
    return { kind, label: "Call", href: `tel:${contact.phone}` };
  if (kind === "email" && contact.email)
    return {
      kind,
      label: "Email",
      href: `mailto:${encodeURIComponent(contact.email).replace("%40", "@")}`,
    };
}
