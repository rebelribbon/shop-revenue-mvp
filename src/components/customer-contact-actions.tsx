import { ContactLaunchLink } from "./correspondence";
import { WorkspaceIcon } from "./workspace-icon";
import type {
  CorrespondenceChannel,
  CorrespondenceTarget,
} from "@/lib/correspondence";

export function CustomerContactActions({
  phone,
  target,
  email,
  textAllowed = true,
  emailAllowed = true,
  compact = false,
}: {
  target?: CorrespondenceTarget;
  phone?: string | null;
  email?: string | null;
  textAllowed?: boolean;
  emailAllowed?: boolean;
  compact?: boolean;
}) {
  const actions: {
    label: string;
    href: string;
    channel: CorrespondenceChannel;
  }[] = [];
  if (phone)
    actions.push({ label: "Call", channel: "call", href: `tel:${phone}` });
  if (phone && textAllowed)
    actions.push({ label: "Text", channel: "text", href: `sms:${phone}` });
  if (email && emailAllowed)
    actions.push({ label: "Email", channel: "email", href: `mailto:${email}` });
  if (!actions.length) return null;

  return (
    <div
      className={`customer-contact-actions${compact ? " customer-contact-actions-compact" : ""}`}
      role="group"
      aria-label="Contact customer"
    >
      <div className="customer-contact-buttons">
        {actions.map((action) => (
          <ContactLaunchLink
            contact={target}
            channel={action.channel}
            key={action.label}
            className={compact ? "btn secondary contact-icon-button" : "btn secondary"}
            href={action.href}
            aria-label={compact ? action.label : undefined}
            title={compact ? action.label : undefined}
          >
            {compact ? (
              <WorkspaceIcon name={action.channel === "call" ? "phone" : action.channel === "text" ? "message" : "mail"} />
            ) : action.label}
          </ContactLaunchLink>
        ))}
      </div>
    </div>
  );
}
