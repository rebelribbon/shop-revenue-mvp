"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionHydration } from "./action-hydration";
import { saveTemplateAction } from "@/server/actions/documents";
import type { DocumentField } from "@/db/schema/documents";

const TYPES: [DocumentField["type"], string][] = [
  ["text", "Text"],
  ["date", "Date"],
  ["checkbox", "Checkbox"],
  ["initials", "Initials"],
];
const slug = (label: string, taken: string[]) => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 30) || "field";
  let key = base,
    n = 2;
  while (taken.includes(key)) key = `${base}_${n++}`;
  return key;
};

// Write the document once: tap info to drop it in, add blanks the customer
// fills, see it as the customer will.
export function TemplateEditor({
  template,
  mergeFields,
  sample,
}: {
  template?: {
    id: string;
    name: string;
    body: string;
    fields: DocumentField[];
  };
  mergeFields: readonly (readonly [string, string])[];
  sample: Record<string, string>;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [fields, setFields] = useState<DocumentField[]>(template?.fields ?? []);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const insert = (key: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, at)}{{${key}}}${body.slice(at)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + key.length + 4;
      el?.setSelectionRange(pos, pos);
    });
  };
  const preview = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) =>
    k in sample ? sample[k] : m,
  );
  return (
    <form
      className="card"
      data-ux-ready={ready}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await saveTemplateAction({
            ...(template ? { templateId: template.id } : {}),
            name,
            body,
            fields,
            clientRequestId: crypto.randomUUID(),
          });
          if (r.ok) {
            setMessage("Saved.");
            router.push("/app/settings/documents?saved=1");
            router.refresh();
          } else setMessage(r.error.message);
        } catch {
          setMessage("Couldn’t save. Your changes are still here.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Document name
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Work authorization"
        />
      </label>
      <label>
        Document text
        <textarea
          ref={area}
          required
          rows={10}
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <fieldset className="chips">
        <legend>Tap to add info that fills in automatically</legend>
        {mergeFields.map(([key, label]) => (
          <button
            type="button"
            className="btn secondary"
            key={key}
            onClick={() => insert(key)}
          >
            + {label}
          </button>
        ))}
      </fieldset>
      <h3>Blanks the customer fills in</h3>
      <p className="muted">
        A signature and printed name are always included at the end.
      </p>
      {fields.map((f, i) => (
        <fieldset key={i}>
          <legend>Blank {i + 1}</legend>
          <label>
            What to ask
            <input
              required
              maxLength={120}
              value={f.label}
              onChange={(e) =>
                setFields(
                  fields.map((x, n) =>
                    n === i ? { ...x, label: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            Type
            <select
              value={f.type}
              onChange={(e) =>
                setFields(
                  fields.map((x, n) =>
                    n === i
                      ? { ...x, type: e.target.value as DocumentField["type"] }
                      : x,
                  ),
                )
              }
            >
              {TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) =>
                setFields(
                  fields.map((x, n) =>
                    n === i ? { ...x, required: e.target.checked } : x,
                  ),
                )
              }
            />
            Required
          </label>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setFields(fields.filter((_, n) => n !== i))}
          >
            Remove blank
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn secondary"
        onClick={() =>
          setFields([
            ...fields,
            {
              key: slug(
                `blank ${fields.length + 1}`,
                fields.map((x) => x.key),
              ),
              label: "",
              type: "text",
              required: true,
            },
          ])
        }
      >
        + Add a blank
      </button>
      <h3>Preview</h3>
      <div className="plan-summary">
        <p style={{ whiteSpace: "pre-wrap" }}>{preview || "…"}</p>
        {fields.map((f, i) => (
          <p key={i}>
            {f.label || "(blank)"}
            {f.required ? " *" : ""}: ______
          </p>
        ))}
        <p>Signature: ______ · Printed name: ______</p>
      </div>
      <button className="btn primary" disabled={busy || !ready}>
        {busy ? "Saving…" : "Save document"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
