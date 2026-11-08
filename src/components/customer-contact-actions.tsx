export function CustomerContactActions({
  phone,
  email,
  textAllowed = true,
  emailAllowed = true,
}: {
  phone?: string | null;
  email?: string | null;
  textAllowed?: boolean;
  emailAllowed?: boolean;
}) {
  const actions: { label: string; href: string }[] = [];
  if (phone) actions.push({ label: "Call", href: `tel:${phone}` });
  if (phone && textAllowed)
    actions.push({ label: "Text", href: `sms:${phone}` });
  if (email && emailAllowed)
    actions.push({ label: "Email", href: `mailto:${email}` });
  if (!actions.length) return null;

  return (
    <div
      className="customer-contact-actions"
      role="group"
      aria-label="Contact customer"
    >
      <div className="customer-contact-buttons">
        {actions.map((action) => (
          <a key={action.label} className="btn secondary" href={action.href}>
            {action.label}
          </a>
        ))}
      </div>
    </div>
  );
}
