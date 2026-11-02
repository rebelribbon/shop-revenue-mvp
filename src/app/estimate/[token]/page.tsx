import { HydratedMain } from "@/components/hydrated-main";
import { PrintDocument } from "@/components/invoice-controls";
import { notFound } from "next/navigation";
import { readPublicEstimate } from "@/domain/estimates";
import {
  AuthorizedTotal,
  EstimateDocument,
} from "@/components/estimate-document";
import { EstimateSignature } from "@/components/estimate-signature";
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
