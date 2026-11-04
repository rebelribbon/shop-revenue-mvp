"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  InspectionItem,
  InspectionStatus,
} from "@/lib/inspection-templates";
import { saveInspectionAction } from "@/server/actions/inspections";
import { useActionHydration } from "./action-hydration";

const CHOICES: { status: InspectionStatus; label: string }[] = [
  { status: "good", label: "Good" },
  { status: "watch", label: "Watch" },
  { status: "fix", label: "Needs work" },
];

export function InspectionForm({
  jobId,
  initial,
  readOnly,
}: {
  jobId: string;
  initial: InspectionItem[];
  readOnly: boolean;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const set = (key: string, patch: Partial<InspectionItem>) => {
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setMessage("");
  };
  return (
    <form
      className="inspection"
      data-ux-ready={ready}
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending || readOnly) return;
        setPending(true);
        try {
          const r = await saveInspectionAction({
            jobId,
            items: JSON.stringify(items),
            clientRequestId: requestId,
          });
          if (r.ok) {
            setMessage(
              (r.data as { message?: string })?.message ?? "Inspection saved.",
            );
            setRequestId(crypto.randomUUID());
            router.refresh();
          } else setMessage(r.error.message);
        } catch {
          setMessage("Couldn’t save. Your marks are still here; try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <ul className="inspection-list">
        {items.map((i) => (
          <li key={i.key} className={`inspection-item is-${i.status}`}>
            <fieldset disabled={readOnly}>
              <legend>{i.label}</legend>
              <div className="inspection-choices">
                {CHOICES.map((c) => (
                  <label key={c.status} className={`choice-${c.status}`}>
                    <input
                      type="radio"
                      name={`insp-${i.key}`}
                      checked={i.status === c.status}
                      onChange={() => set(i.key, { status: c.status })}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              {(i.status === "watch" || i.status === "fix") && (
                <>
                  <label htmlFor={`insp-note-${i.key}`}>
                    What did you find?
                  </label>
                  <input
                    id={`insp-note-${i.key}`}
                    value={i.note}
                    maxLength={1000}
                    placeholder={
                      i.status === "fix"
                        ? "e.g. pads at 2 mm, rotors scored"
                        : "e.g. tread at 4/32, check next visit"
                    }
                    onChange={(e) => set(i.key, { note: e.target.value })}
                  />
                </>
              )}
              {i.addedToJob && (
                <p className="muted inspection-added">On the estimate</p>
              )}
            </fieldset>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <button className="btn primary" disabled={!ready || pending}>
          {pending ? "Saving…" : "Save inspection"}
        </button>
      )}
      <p role="status">{message}</p>
    </form>
  );
}
