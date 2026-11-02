import Link from "next/link";
import type { MediaItem } from "@/domain/job-media";
import { TAG_LABELS } from "@/lib/media-tags";
import { updateMediaAction } from "@/server/actions/job-media";
import { ActionForm } from "./action-form";

// Thumbnails with their tag, note and whether the customer can see them.
export function MediaGallery({
  items,
  readOnly,
  timeZone,
  quoteHref,
}: {
  items: MediaItem[];
  readOnly: boolean;
  timeZone: string;
  // Where "Quote this" goes for an issue photo not yet on a job.
  quoteHref?: (m: MediaItem) => string;
}) {
  if (!items.length) return <p className="muted">No photos or videos yet.</p>;
  return (
    <div className="media-grid">
      {items.map((m) => (
        <figure className="media-tile" key={m.id}>
          <a href={`/media/${m.fileId}`} target="_blank" rel="noreferrer">
            {m.mediaType === "video" ? (
              <video src={`/media/${m.fileId}`} preload="metadata" muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/media/${m.fileId}`}
                alt={m.caption || TAG_LABELS[m.tag]}
                loading="lazy"
              />
            )}
          </a>
          <figcaption>
            <span className={`pill${m.tag === "issue" ? " pill-warn" : ""}`}>
              {TAG_LABELS[m.tag]}
            </span>
            {m.showCustomer && (
              <span className="pill pill-ok">Customer sees</span>
            )}
            {m.caption && <span>{m.caption}</span>}
            <span className="muted">
              {m.createdAt.toLocaleDateString("en-US", {
                timeZone,
                month: "short",
                day: "numeric",
              })}
            </span>
            {m.tag === "issue" && !m.jobId && quoteHref && !readOnly && (
              <Link className="btn primary" href={quoteHref(m)}>
                Quote this
              </Link>
            )}
            {!readOnly && (
              <details>
                <summary>Edit</summary>
                <ActionForm
                  action={updateMediaAction}
                  hidden={{
                    mediaId: m.id,
                    showCustomer: m.showCustomer ? "false" : "true",
                  }}
                  submitLabel={
                    m.showCustomer ? "Hide from customer" : "Show the customer"
                  }
                  variant="secondary"
                />
                <ActionForm
                  action={updateMediaAction}
                  hidden={{ mediaId: m.id }}
                  submitLabel="Save"
                  variant="secondary"
                >
                  <label htmlFor={`tag-${m.id}`}>What is it?</label>
                  <select id={`tag-${m.id}`} name="tag" defaultValue={m.tag}>
                    {Object.entries(TAG_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`cap-${m.id}`}>Note</label>
                  <input
                    id={`cap-${m.id}`}
                    name="caption"
                    maxLength={500}
                    defaultValue={m.caption ?? ""}
                  />
                </ActionForm>
                <ActionForm
                  action={updateMediaAction}
                  hidden={{ mediaId: m.id, remove: "true" }}
                  submitLabel="Remove"
                  variant="danger"
                  confirm="Remove this photo? Estimates already signed keep their copy."
                />
              </details>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

// Read-only strip for customer-facing estimates and invoices.
export function CustomerPhotos({
  photos,
  token,
}: {
  photos: {
    fileId: string;
    mediaType: string;
    tag: string;
    caption: string | null;
  }[];
  token?: string;
}) {
  if (!photos.length) return null;
  const src = (id: string) =>
    `/media/${id}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  return (
    <section aria-label="Photos">
      <h3>Photos</h3>
      <div className="media-grid">
        {photos.map((p) => (
          <figure className="media-tile" key={p.fileId}>
            <a href={src(p.fileId)} target="_blank" rel="noreferrer">
              {p.mediaType === "video" ? (
                <video src={src(p.fileId)} preload="metadata" controls />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src(p.fileId)}
                  alt={
                    p.caption || TAG_LABELS[p.tag as keyof typeof TAG_LABELS]
                  }
                  loading="lazy"
                />
              )}
            </a>
            <figcaption>
              <span className="pill">
                {TAG_LABELS[p.tag as keyof typeof TAG_LABELS] ?? p.tag}
              </span>
              {p.caption && <span>{p.caption}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
