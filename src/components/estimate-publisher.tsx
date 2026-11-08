"use client";
import { useActionHydration } from "./action-hydration";
import Link from "next/link";
import { DocumentShare, type ShareData } from "./document-share";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  rotateEstimateLinkAction,
  freezeEstimateAction,
} from "@/server/actions/estimates";
export function EstimatePublisher({
  jobId,
  version,
  existingVersion,
  taxRateBps = 0,
  pendingChanges = false,
}: {
  jobId: string;
  version: string;
  existingVersion?: number;
  taxRateBps?: number;
  // The job changed since the latest estimate: show the resend form open.
  pendingChanges?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [path, setPath] = useState("");
  const [publishedId, setPublishedId] = useState("");
  const [share, setShare] = useState<ShareData | undefined>();
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const ready = useActionHydration();
  const router = useRouter();
  if (path || publishedId)
    return (
      <section data-ux-ready={ready}>
        <h4>Estimate saved — send it for authorization</h4>
        <p>
          Step 2 of 2: Confirm a customer email or phone number and send the
          secure approval link. The estimate is already in this job’s file
          cabinet.
        </p>
        {publishedId && (
          <DocumentShare
            id={publishedId}
            kind="estimate"
            primary
            autoOpen
            initial={share}
          />
        )}
        <p role="status">
          Your customer can approve or decline each priced item and sign. You
          can track the result on the job.
        </p>
        <Link href={`/app/jobs?job=${jobId}`}>
          Job timeline &amp; next step
        </Link>
      </section>
    );
  const form = (
    <form
      data-ux-ready={ready}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setPending(true);
        try {
          const result = await freezeEstimateAction({
            jobId,
            expectedJobVersion: version,
            taxBps: Math.round(Number(f.get("taxPercent")) * 100),
            terms: String(f.get("terms") ?? ""),
            supplementReason: String(f.get("supplementReason") ?? ""),
            clientRequestId: requestId,
          });
          if (result.ok) {
            const data = result.data as { path?: string };
            setPath(data.path ?? "");
            setPublishedId((result.data as { id: string }).id);
            setShare((result.data as { share?: typeof share }).share);
            setMessage("Estimate prepared. Choose a recipient to send it.");
            setRequestId(crypto.randomUUID());
            router.refresh();
          } else setMessage(result.error.message);
        } catch {
          setMessage("Unable to create the link. Please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset className="hydration-fields" disabled={!ready}>
        <h4>Step 1 of 2 — Prepare the estimate</h4>
        <p>
          Review the work and prices. This saves a fixed estimate in the job and
          opens the recipient and delivery options; it does not send anything
          until you confirm a recipient.
        </p>
        {taxRateBps === 0 && (
          <p className="muted" role="note">
            <strong>Sales tax is set to 0%.</strong> Taxable items will go out
            with no tax. Set your rate in{" "}
            <Link href="/app/settings/business">Business profile</Link>, or
            enter it under Tax and customer notes below.
          </p>
        )}
        <details>
          <summary>Tax and customer notes</summary>
          <label>
            Tax rate (%)
            <input
              name="taxPercent"
              type="number"
              min="0"
              max="20"
              step="0.01"
              defaultValue={taxRateBps / 100}
              required
            />
          </label>
          <p className="muted">
            Applied only to lines marked taxable on the job sheet. Starts from
            your business default; confirm the rate and line flags before
            publishing.
          </p>
          <label>
            Customer terms
            <textarea name="terms" maxLength={5000} rows={3} />
          </label>
          <p className="muted">Changes need the customer’s approval again.</p>
        </details>{" "}
        <label hidden={!existingVersion}>
          What changed?
          <textarea
            required={!!existingVersion}
            name="supplementReason"
            maxLength={2000}
            rows={2}
          />
        </label>
        <button
          className="btn secondary"
          data-page-primary={!existingVersion ? "true" : undefined}
          disabled={pending}
        >
          {pending ? "Preparing…" : "Prepare estimate & choose recipient"}
        </button>
        <p role="status">{message}</p>
        {path && (
          <p>
            <a href={path} target="_blank" rel="noreferrer">
              Open customer estimate
            </a>
            <br />
            <label>
              Customer link
              <input
                readOnly
                value={`${window.location.origin}${path}`}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
          </p>
        )}
      </fieldset>
    </form>
  );
  return existingVersion ? (
    <details open={pendingChanges || undefined}>
      <summary>
        {pendingChanges ? "Send updated estimate" : "Change estimate"}
      </summary>
      {form}
    </details>
  ) : (
    form
  );
}

export function EstimateLink({ id }: { id: string }) {
  const ready = useActionHydration();
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div data-ux-ready={ready}>
      <DocumentShare id={id} kind="estimate" />
      <details>
        <summary>Older link options</summary>
        <button
          type="button"
          className="btn secondary"
          disabled={pending}
          onClick={async () => {
            if (
              !window.confirm(
                "Replace this link? The previous customer link will stop working.",
              )
            )
              return;
            setPending(true);
            try {
              const r = await rotateEstimateLinkAction({
                id,
                clientRequestId: crypto.randomUUID(),
              });
              if (r.ok) setPath((r.data as { path: string }).path);
              else setMessage(r.error.message);
            } catch {
              setMessage("Unable to replace link.");
            } finally {
              setPending(false);
            }
          }}
        >
          Replace older link
        </button>
        {path && <a href={path}>Open customer estimate</a>}
        <p role="status">{message}</p>
      </details>
    </div>
  );
}
