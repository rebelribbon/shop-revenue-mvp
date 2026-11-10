"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionHydration } from "./action-hydration";
import {
  finishMediaUploadAction,
  prepareMediaUploadAction,
} from "@/server/actions/job-media";

type Tag = "before" | "after" | "issue" | "quote" | "other";
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
}: {
  customerId: string;
  jobId?: string;
  vehicleId?: string | null;
  serviceAssetId?: string | null;
  appointmentId?: string;
  defaultTag?: Tag;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [tag, setTag] = useState<Tag>(defaultTag);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList) => {
    setBusy(true);
    let done = 0;
    try {
      for (const original of Array.from(files)) {
        setStatus(`Uploading ${done + 1} of ${files.length}…`);
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
          tag,
          caption,
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
    <div className="media-uploader" data-ux-ready={ready}>
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
      <label>
        Note (optional)
        <input
          maxLength={500}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={
            tag === "issue" ? "Brake pads at 2mm, rotors grooved" : ""
          }
        />
      </label>
      <p className="muted">
        Uploads are private until a service advisor approves sharing.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.length && upload(e.target.files)}
      />
      <button
        type="button"
        className="btn secondary"
        disabled={busy || !ready}
        onClick={() => input.current?.click()}
      >
        {busy ? "Uploading…" : "📷 Add photos / video"}
      </button>
      <p role="status">{status}</p>
    </div>
  );
}
