"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionHydration } from "./action-hydration";
import {
  finishMediaUploadAction,
  prepareMediaUploadAction,
} from "@/server/actions/job-media";

type Tag = "before" | "after" | "issue" | "quote" | "other";
type MediaPurpose = "general" | "intake" | "finding" | "walkaround";
const TAGS: [Tag, string][] = [
  ["before", "Before"],
  ["after", "After"],
  ["issue", "Found an issue"],
  ["quote", "For the quote"],
  ["other", "Other"],
];

// Photos are shrunk on the phone (max 2000px JPEG) so uploads are quick on a
// job site; videos are limited to about a minute.
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic")
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.82),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
const videoSeconds = (file: File) =>
  new Promise<number>((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(v.duration);
    };
    v.onerror = () => resolve(0);
    v.src = URL.createObjectURL(file);
  });

export function MediaUploader({
  customerId,
  jobId,
  vehicleId,
  serviceAssetId,
  appointmentId,
  defaultTag = "before",
  purpose = "general",
  inspectionItemKey,
  inspectionItemLabel,
}: {
  customerId: string;
  jobId?: string;
  vehicleId?: string | null;
  serviceAssetId?: string | null;
  appointmentId?: string;
  defaultTag?: Tag;
  purpose?: MediaPurpose;
  inspectionItemKey?: string;
  inspectionItemLabel?: string;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const specialized = purpose !== "general";
  const [tag, setTag] = useState<Tag>(defaultTag);
  const effectiveTag: Tag =
    purpose === "intake" ? "before" : purpose === "finding" ? "issue" : purpose === "walkaround" ? "quote" : tag;
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList) => {
    setBusy(true);
    let done = 0;
    try {
      for (const original of Array.from(files)) {
        setStatus(`Uploading ${done + 1} of ${files.length}…`);
        if (purpose === "walkaround" && !original.type.startsWith("video/")) {
          setStatus("Record a short video for the walkaround.");
          continue;
        }
        if ((purpose === "finding" || purpose === "intake") && !original.type.startsWith("image/")) {
          setStatus("Choose a photo for this step.");
          continue;
        }
        if (original.type.startsWith("video/")) {
          const secs = await videoSeconds(original);
          if (secs > 75) {
            setStatus(
              "Videos can be up to about a minute. Trim it and try again.",
            );
            continue;
          }
        }
        const body = await shrink(original);
        const contentType =
          body === original ? original.type || "image/jpeg" : "image/jpeg";
        const prep = await prepareMediaUploadAction({
          customerId,
          contentType,
          byteSize: body.size,
          clientRequestId: crypto.randomUUID(),
        });
        if (!prep.ok) {
          setStatus(prep.error.message);
          continue;
        }
        const { fileId, uploadUrl } = prep.data as {
          fileId: string;
          uploadUrl: string;
        };
        const put = await fetch(uploadUrl, {
          method: "PUT",
          body,
          headers: { "Content-Type": contentType },
        });
        if (!put.ok) {
          setStatus(
            "The upload was interrupted. Check your signal and try again.",
          );
          continue;
        }
        const fin = await finishMediaUploadAction({
          fileId,
          customerId,
          ...(jobId ? { jobId } : {}),
          ...(vehicleId ? { vehicleId } : {}),
          ...(serviceAssetId ? { serviceAssetId } : {}),
          ...(appointmentId ? { appointmentId } : {}),
          tag: effectiveTag,
          caption: purpose === "finding"
            ? `Inspection: ${inspectionItemLabel || inspectionItemKey || "Finding"}${caption.trim() ? ` — ${caption.trim()}` : ""}`.slice(0, 500)
            : purpose === "intake"
              ? `Vehicle check-in${caption.trim() ? ` — ${caption.trim()}` : ""}`.slice(0, 500)
              : purpose === "walkaround"
                ? `Technician inspection summary video${caption.trim() ? ` — ${caption.trim()}` : ""}`.slice(0, 500)
                : caption,
          ...(specialized ? { mediaPurpose: purpose } : {}),
          ...(purpose === "finding" && inspectionItemKey ? { inspectionItemKey } : {}),
          clientRequestId: crypto.randomUUID(),
        });
        if (!fin.ok) {
          setStatus(fin.error.message);
          continue;
        }
        done++;
      }
      if (done) {
        setStatus(`${done} added.`);
        setCaption("");
        router.refresh();
      }
    } catch {
      setStatus("Couldn’t upload. Please try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className={`media-uploader${specialized ? " media-uploader-compact" : ""}`} data-ux-ready={ready}>
      {!specialized && (
        <fieldset className="chips">
          <legend>What is it?</legend>
          {TAGS.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name={`media-tag-${jobId ?? customerId}`}
                checked={tag === value}
                onChange={() => setTag(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {!specialized && (
        <label>
          Note (optional)
          <input
            maxLength={500}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Describe the photo or video"
          />
        </label>
      )}
      <input
        ref={input}
        type="file"
        accept={purpose === "walkaround" ? "video/*" :
          purpose === "finding" || purpose === "intake" ? "image/*" : "image/*,video/*"}
        capture={purpose === "walkaround" || purpose === "finding" || purpose === "intake"
          ? "environment" : undefined}
        multiple={purpose === "intake" || purpose === "general"}
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.length && void upload(e.target.files)}
      />
      <button
        type="button"
        className="btn secondary"
        disabled={busy || !ready}
        onClick={() => input.current?.click()}
      >
        {busy
          ? "Uploading…"
          : purpose === "finding"
            ? "Take evidence photo (optional)"
            : purpose === "intake"
              ? "Take check-in photos"
              : purpose === "walkaround"
                ? "Record 1-minute technician video"
                : "Add photo / video"}
      </button>
      {specialized && <p className="muted">
        {purpose === "finding"
          ? "This photo is linked to this inspection finding. Your advisor chooses what the customer sees."
          : purpose === "intake"
            ? "Document existing body damage before the vehicle goes to the technician. Photos are private."
            : "A brief personal summary for the advisor to review before sharing with the customer."}
      </p>}
      {!specialized && (
        <p className="muted">Media stays private until the advisor approves sharing.</p>
      )}
      <p role="status">{status}</p>
    </div>
  );
}
