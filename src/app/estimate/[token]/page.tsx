import { HydratedMain } from "@/components/hydrated-main";
import { PrintDocument } from "@/components/invoice-controls";
import { notFound } from "next/navigation";
import { readPublicEstimate } from "@/domain/estimates";
import {
  AuthorizedTotal,
  EstimateDocument,
} from "@/components/estimate-document";
import { EstimateSignature } from "@/components/estimate-signature";
import { CustomerPhotos } from "@/components/media-gallery";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review estimate | Shop Revenue",
  robots: { index: false, follow: false },
};
export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const e = await readPublicEstimate(token);
  if (!e) notFound();
  // With an inspection or recommended work, the customer steps through it:
  // their request, the inspection, the recommendations, then signing.
  const stepped =
    !e.authorization &&
    (!!e.snapshot.inspection || e.snapshot.lines.some((l) => l.recommended));
  if (stepped)
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <h1>Estimate · Version {e.version}</h1>
        <p className="estimate-heading">
          <strong>{e.snapshot.shopName}</strong> · {e.snapshot.customerName}
          {e.snapshot.title ? ` · ${e.snapshot.title}` : ""}
        </p>
        {e.supplementReason && (
          <p className="notice">Change / supplement: {e.supplementReason}</p>
        )}
        <EstimateSignature
          token={token}
          snapshot={e.snapshot}
          media={
            e.snapshot.photos?.length ? (
              <CustomerPhotos photos={e.snapshot.photos} token={token} />
            ) : undefined
          }
        />
        {(e.snapshot.warrantyMonths || e.snapshot.terms) && (
          <section className="card">
            {e.snapshot.warrantyMonths && (
              <p data-warranty>
                <strong>Warranty:</strong> {e.snapshot.warrantyMonths}{" "}
                {e.snapshot.warrantyMonths === 1 ? "month" : "months"} on this
                work from the invoice date.
              </p>
            )}
            {e.snapshot.terms && (
              <p style={{ whiteSpace: "pre-wrap" }}>{e.snapshot.terms}</p>
            )}
          </section>
        )}
        <PrintDocument label="Print estimate / Save PDF" />
      </HydratedMain>
    );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Estimate · Version {e.version}</h1>
      <PrintDocument label="Print estimate / Save PDF" />
      {e.supplementReason && (
        <p className="notice">Change / supplement: {e.supplementReason}</p>
      )}
      <p>
        Review the items below and choose which work to authorize. Your decision
        is saved for the shop; signing does not charge a card. Payment is
        requested separately by invoice.
      </p>
      <EstimateDocument snapshot={e.snapshot} photoToken={token} />
      {e.authorization ? (
        <section className="card">
          <h2>Decision recorded</h2>
          {e.snapshot.authorizationPolicy && (
            <p>
              <a href={`/estimate/${token}/authorization.pdf`}>
                Download signed authorization PDF
              </a>
            </p>
          )}
          <p>
            Your approved and declined items are listed below. The shop can now
            confirm scheduling and perform only approved work. No payment has
            been taken by this signature.
          </p>
          <AuthorizedTotal
            snapshot={e.snapshot}
            ids={e.authorization.approvedLineIds}
          />
          <p>
            Signed by {e.authorization.signerName} on{" "}
            {new Date(e.authorization.signedAt).toLocaleString("en-US", {
              timeZone: "America/Chicago",
            })}
          </p>
          <ul>
            {e.snapshot.lines.map((l) => (
              <li key={l.id}>
                {l.description}:{" "}
                {e.authorization!.approvedLineIds.includes(l.id)
                  ? "Approved"
                  : "Declined"}
              </li>
            ))}
          </ul>
          <p>{e.authorization.consentText}</p>
        </section>
      ) : (
        <EstimateSignature token={token} snapshot={e.snapshot} />
      )}
    </HydratedMain>
  );
}
