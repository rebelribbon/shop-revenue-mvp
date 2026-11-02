import { HydratedMain } from "@/components/hydrated-main";
import { notFound } from "next/navigation";
import { SignDocument } from "@/components/sign-document";
import { readPublicDocument } from "@/domain/documents";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Document to sign | Shop Revenue",
  robots: { index: false, follow: false },
};

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const d = await readPublicDocument(token);
  if (!d) notFound();
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p className="muted">{d.shopName}</p>
      <h1>{d.title}</h1>
      <section className="card">
        <p style={{ whiteSpace: "pre-wrap" }}>{d.body}</p>
      </section>
      {d.status === "signed" ? (
        <section className="card">
          <h2>Signed</h2>
          <p>
            Signed by {d.signerName} on{" "}
            {d.signedAt &&
              new Date(d.signedAt).toLocaleString("en-US", {
                timeZone: "America/Chicago",
                dateStyle: "medium",
                timeStyle: "short",
              })}
            .
          </p>
          {d.fields.map((f) => (
            <p key={f.key}>
              {f.label}:{" "}
              {f.type === "checkbox"
                ? d.values?.[f.key]
                  ? "Yes"
                  : "No"
                : String(d.values?.[f.key] ?? "") || "—"}
            </p>
          ))}
          <a
            className="btn primary"
            data-page-primary
            href={`/sign/${token}/pdf`}
          >
            Download your signed copy (PDF)
          </a>
        </section>
      ) : (
        <SignDocument token={token} fields={d.fields} />
      )}
    </HydratedMain>
  );
}
