import type { CabinetItem } from "@/domain/documents";
import {
  removeDocumentAction,
  voidDocumentAction,
} from "@/server/actions/documents";
import { ActionForm } from "./action-form";
import { CopyLink } from "./copy-link";
import { DocumentShare } from "./document-share";

// Every document for a job: what the app created, what was sent to sign, and
// what someone added.
export function FileCabinet({
  items,
  customerPhone,
  customerEmail,
  readOnly,
  autoOpenShare = false,
  timeZone,
}: {
  items: CabinetItem[];
  customerPhone: string | null;
  customerEmail: string | null;
  readOnly: boolean;
  autoOpenShare?: boolean;
  timeZone: string;
}) {
  const groups: CabinetItem["group"][] = [
    "Signed & sent",
    "Created for this job",
    "Added files",
  ];
  const when = (d: Date) =>
    d.toLocaleString("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  return (
    <section aria-label="File cabinet" id="file-cabinet">
      <h3>🗂 File cabinet</h3>
      {groups.map((g) => {
        const list = items.filter((i) => i.group === g);
        return (
          <div key={g}>
            <h4>{g}</h4>
            {!list.length && <p className="muted">Nothing yet.</p>}
            {list.map((i) => (
              <div className="overview-row cabinet-row" key={i.id}>
                <span>
                  {i.href ? (
                    <a
                      href={i.href}
                      target={i.href.startsWith("/app/") ? undefined : "_blank"}
                      rel="noreferrer"
                    >
                      📄 {i.title}
                    </a>
                  ) : (
                    <strong>📄 {i.title}</strong>
                  )}
                  <span className="muted">
                    {" "}
                    · {i.detail} · {when(i.at)}
                  </span>
                </span>
                {i.status && (
                  <span
                    className={
                      i.status === "Signed"
                        ? "pill pill-ok"
                        : i.status === "Waiting"
                          ? "pill pill-warn"
                          : "pill pill-muted"
                    }
                  >
                    {i.status}
                  </span>
                )}
                {i.estimateShareId && !readOnly && (
                  <DocumentShare
                    id={i.estimateShareId}
                    kind="estimate"
                    label="Send estimate for approval"
                    autoOpen={autoOpenShare}
                  />
                )}
                {i.signLink && !readOnly && (
                  <span className="money-actions">
                    <CopyLink
                      path={i.signLink}
                      label="Copy signing link"
                      title={i.title}
                      phone={customerPhone}
                      email={customerEmail}
                    />
                    <ActionForm
                      action={voidDocumentAction}
                      hidden={{ documentId: i.documentId! }}
                      submitLabel="Void"
                      variant="danger"
                      confirm="Void this document? The customer's link stops working."
                    />
                  </span>
                )}
                {g === "Added files" && !readOnly && i.documentId && (
                  <ActionForm
                    action={removeDocumentAction}
                    hidden={{ documentId: i.documentId }}
                    submitLabel="Remove"
                    variant="danger"
                    confirm={`Remove ${i.title}?`}
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
