import { HydratedMain } from "@/components/hydrated-main";
import { ProposalOpenTracker } from "@/components/proposal-open-tracker";
import { notFound } from "next/navigation";
import { readPublicEstimate } from "@/domain/estimates";
import {
  readPublicDocument,
  unsafeCustomerPricedChangeOrder,
} from "@/domain/documents";
import {
  EstimateDocument,
  AuthorizedTotal,
} from "@/components/estimate-document";
import { EstimateSignature } from "@/components/estimate-signature";
import { SignDocument } from "@/components/sign-document";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review and sign documents | Shop Revenue",
  robots: { index: false, follow: false },
};

export default async function CustomerPacketPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; d?: string | string[] }>;
}) {
  const search = await searchParams;
  const estimateToken = search.e;
  const docTokens =
    typeof search.d === "string"
      ? [search.d]
      : Array.isArray(search.d)
        ? search.d
        : [];
  if (
    !estimateToken ||
    !/^[A-Za-z0-9_-]{43}$/.test(estimateToken) ||
    docTokens.length > 8 ||
    new Set(docTokens).size !== docTokens.length ||
    docTokens.some((t) => !/^[A-Za-z0-9_-]{43}$/.test(t))
  )
    notFound();

  const estimate = await readPublicEstimate(estimateToken);
  if (!estimate) notFound();
  const documents = await Promise.all(
    docTokens.map(async (token) => ({
      token,
      value: await re¶»§q«^