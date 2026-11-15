import { HydratedMain } from "@/components/hydrated-main";
import { ProposalOpenTracker } from "@/components/proposal-open-tracker";
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
        <ProposalOpenTracker token={token} />
        <h1>Estimate · Version {e.version}</h1>
        <p className="estimate-heading">
          <strong>{e.snapshot.shopName}</strong> · {e.snapshot.customerName}
          {e.snapshot.title ? ` · ${e.snapshot.title}` :¶»§q«^