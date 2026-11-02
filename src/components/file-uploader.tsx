"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionHydration } from "./action-hydration";
import {
  fileDocumentAction,
  prepareDocumentUploadAction,
} from "@/server/actions/documents";

// Pick what it is, name it (optional), choose the file. PDFs and photos.
export function FileUploader({
  customerId,
  jobId,
  categories,
  buttonLabel = "+ Add a file",
}: {
  customerId: string;
  jobId?: string;
  categories: readonly (readonly [string, string])[];
  buttonLabel?: string;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(categories[0][0]);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async (f: File) => {
    setBusy(true);
    setStatus("Uploading…");
    try {
      const type =
        f.type ||
        (f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
      const prep = await prepareDocumentUploadAction({
        customerId,
        contentType: type,
        byteSize: f.size,
        clientRequestId: crypto.randomUUID(),
      });
      if (!prep.ok) return setStatus(prep.error.message);
      const { fileId, uploadUrl } = prep.data as {
        fileId: string;
        uploadUrl: string;
      };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: f,
        headers: { "Content-Type": type },
      });
      if (!put.ok)
        return setStatus("The upload was interrupted. Please try again.");
      const done = await fileDocumentAction({
        fileId,
        customerId,
        ...(jobId ? { jobId } : {}),
        category,
        title: title || f.name.replace(/\.[^.]+$/, ""),
        clientRequestId: crypto.randomUUID(),
      });
      if (!done.ok) return setStatus(done.error.message);
      setStatus("Added.");
      setTitle("");
      router.refresh();
    } catch {
      setStatus("Couldn’t upload. Please try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="file-uploader" data-ux-ready={ready}>
      <label>
        What is it?
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name (optional)
        <input
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <button
        type="button"
        className="btn secondary"
        disabled={busy || !ready}
        onClick={() => input.current?.click()}
      >
        {busy ? "Uploading…" : buttonLabel}
      </button>
      <p role="status">{status}</p>
    </div>
  );
}
