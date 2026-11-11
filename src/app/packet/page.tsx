import { HydratedMain } from "@/components/hydrated-main";
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
      value: await readPublicDocument(token),
    })),
  );
  // Do not quietly omit a missing/expired item from a signature packet:
  // customers must never think they completed all requested documents.
  if (documents.some((d) => !d.value)) notFound();
  const done =
    Number(Boolean(estimate.authorization)) +
    documents.filter((d) => d.value?.status === "signed").length;
  const total = 1 + documents.length;

  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Review and authorize your service</h1>
      <p className="muted">
        {estimate.snapshot.shopName} · {estimate.snapshot.customerName}
      </p>
      <section className="card" aria-label="Packet progress">
        <h2>Your documents</h2>
        <p role="status">
          {done} of {total} completed
        </p>
        <ol>
          <li>
            Estimate v{estimate.version} —{" "}
            {estimate.authorization ? "Signed" : "Your approval needed"}
          </li>
          {documents.map(({ token, value }) => (
            <li key={token}>
              {value!.title} —{" "}
              {value!.status === "signed" ? "Signed" : "Your signature needed"}
            </li>
          ))}
        </ol>
        <p>
          Only the shop sets work and prices. Your signature authorizes the
          selected items; it does not take payment. You can decline work.
        </p>
      </section>

      <section aria-label="Estimate approval">
        <h2>1. Estimate and work authorization</h2>
        {estimate.supplementReason && (
          <p className="notice">Updated work: {estimate.supplementReason}</p>
        )}
        <EstimateDocument
          snapshot={estimate.snapshot}
          photoToken={estimateToken}
        />
        {estimate.authorization ? (
          <section className="card">
            <h3>Estimate authorization recorded</h3>
            <AuthorizedTotal
              snapshot={estimate.snapshot}
              ids={estimate.authorization.approvedLineIds}
            />
            <p>Signed by {estimate.authorization.signerName}</p>
            <a href={`/estimate/${estimateToken}/authorization.pdf`}>
              Download your signed approval
            </a>
          </section>
        ) : (
          <EstimateSignature
            token={estimateToken}
            snapshot={estimate.snapshot}
          />
        )}
      </section>

      {documents.map(({ token, value: d }, index) => (
        <section key={token} className="card" aria-label={d!.title}>
          <h2>
            {index + 2}. {d!.title}
          </h2>
          <p className="muted">{d!.shopName}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{d!.body}</p>
          {d!.status === "signed" ? (
            <section>
              <h3>Signed</h3>
              <p>Signed by {d!.signerName}</p>
              <a href={`/sign/${token}/pdf`}>Download your signed copy</a>
            </section>
          ) : unsafeCustomerPricedChangeOrder(d!) ? (
            <p role="alert" className="notice">
              This older change order must be corrected by the shop before it
              can be signed.
            </p>
          ) : (
            <SignDocument token={token} fields={d!.fields} />
          )}
        </section>
      ))}
      {done === total ? (
        <section className="card">
          <h2>All documents completed</h2>
          <p>
            Thank you. Your decisions and signed copies are saved with the shop.
          </p>
        </section>
      ) : (
        <p className="muted">
          After each signature, this page updates the completed-document count.
        </p>
      )}
    </HydratedMain>
  );
}
