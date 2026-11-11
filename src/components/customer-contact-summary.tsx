export function CustomerContactSummary({
  phone,
  email,
  address,
  addressHref,
}: {
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  addressHref?: string;
}) {
  return (
    <dl className="customer-contact-summary" aria-label="Contact details">
      <div>
        <dt>Phone</dt>
        <dd>{phone || "Phone not added"}</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>{email || "Email not added"}</dd>
      </div>
      <div>
        <dt>Address</dt>
        <dd>
          {address && addressHref ? (
            <a href={addressHref} target="_blank" rel="noreferrer">
              {address}
            </a>
          ) : (
            address || "Address not added"
          )}
        </dd>
      </div>
    </dl>
  );
}
