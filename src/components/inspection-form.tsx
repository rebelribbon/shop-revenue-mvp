"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  InspectionItem,
  InspectionStatus,
  InspectionAssessment,
} from "@/lib/inspection-templates";
import { saveInspectionAction } from "@/server/actions/inspections";
import { useActionHydration } from "./action-hydration";

const CHOICES: { status: InspectionStatus; label: string }[] = [
  { status: "good", label: "Satisfactory" },
  { status: "watch", label: "Service Soon" },
  { status: "fix", label: "Service Now" },
  { status: "na", label: "N/A" },
];

export function InspectionForm({
  jobId,
  initial,
  readOnly,
  completed = false,
  initialAssessment,
  automotive = true,
}: {
  jobId: string;
  initial: InspectionItem[];
  readOnly: boolean;
  completed?: boolean;
  initialAssessment: InspectionAssessment;
  automotive?: boolean;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [assessment, setAssessment] = useState(initialAssessment);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const sections = useMemo(
    () => [...new Set(items.map((i) => i.section || "Inspection"))],
    [items],
  );
  const current =
    sections[Math.min(sectionIndex, sections.length - 1)] ?? "Inspection";
  const visible = items.filter((i) => (i.section || "Inspection") === current);
  const checked = items.filter((i) => i.status !== "unchecked").length;
  const allChecked = checked === items.length && items.length > 0;
  const requiredNotes = items.every(
    (i) => !["watch", "fix"].includes(i.status) || !!i.note.trim(),
  );
  const requiredWork = items.every(
    (i) => i.status !== "fix" || !!i.recommendedWork?.trim(),
  );
  const canSubmit =
    allChecked &&
    requiredNotes &&
    requiredWork &&
    assessment.vehiclePickedUp &&
    !!assessment.bay.trim() &&
    !!assessment.diagnosis.trim();
  const set = (key: string, patch: Partial<InspectionItem>) => {
    setItems((all) =>
      all.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
    setMessage("");
  };
  async function save(submit: boolean) {
    if (pending || readOnly || !ready) return;
    if (submit && !canSubmit) {
      setMessage(
        "Complete all items. Service Soon needs findings; Service Now also requires recommended work.",
      );
      return;
    }
    setPending(true);
    try {
      const result = await saveInspectionAction({
        jobId,
        items: JSON.stringify(items),
        submit,
        assessment: {
          diagnosis: assessment.diagnosis,
          bay: assessment.bay,
          vehiclePickedUp: assessment.vehiclePickedUp,
        },
        clientRequestId: requestId,
      });
      if (result.ok) {
        setMessage(
          (result.data as { message?: string })?.message ?? "Inspection saved.",
        );
        setRequestId(crypto.randomUUID());
        router.refresh();
      } else setMessage(result.error.message);
    } catch {
      setMessage(
        "Could not save. Your inspection selections remain here; please retry.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="inspection" data-ux-ready={ready}>
      <fieldset disabled={readOnly || completed || !ready || pending}>
        <legend>
          {automotive ? "Pickup and diagnosis" : "Arrival and assessment"}
        </legend>
        <label>
          <input
            type="checkbox"
            checked={assessment.vehiclePickedUp}
            onChange={(event) =>
              setAssessment((current) => ({
                ...current,
                vehiclePickedUp: event.target.checked,
              }))
            }
          />
          {automotive
            ? "I have picked up the vehicle for assessment"
            : "I have arrived at the service location"}
        </label>
        <label htmlFor={`inspection-bay-${jobId}`}>
          {automotive ? "Bay / rack" : "Work area"}
        </label>
        <input
          id={`inspection-bay-${jobId}`}
          maxLength={120}
          value={assessment.bay}
          onChange={(event) =>
            setAssessment((current) => ({
              ...current,
              bay: event.target.value,
            }))
          }
        />
        <label htmlFor={`inspection-diagnosis-${jobId}`}>
          Technician diagnosis
        </label>
        <textarea
          id={`inspection-diagnosis-${jobId}`}
          rows={3}
          maxLength={4000}
          value={assessment.diagnosis}
          onChange={(event) =>
            setAssessment((current) => ({
              ...current,
              diagnosis: event.target.value,
            }))
          }
        />
      </fieldset>
      <div className="inspection-section-header">
        <p>
          <strong>{items.length}-point inspection</strong> · {checked} of{" "}
          {items.length} checked
        </p>
        <h4>{current}</h4>
        <div
          className="inspection-section-tabs"
          aria-label="Inspection categories"
        >
          {sections.map((section, index) => (
            <button
              type="button"
              key={section}
              aria-label={section}
              aria-current={sectionIndex === index ? "step" : undefined}
              className={sectionIndex === index ? "active" : ""}
              onClick={() => setSectionIndex(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
      <ul className="inspection-list">
        {visible.map((i) => (
          <li key={i.key} className={`inspection-item is-${i.status}`}>
            <fieldset disabled={readOnly || completed || !ready || pending}>
              <legend>{i.label}</legend>
              {i.hint && <p className="muted">{i.hint}</p>}
              <div className="inspection-choices">
                {CHOICES.map((choice) => (
                  <label
                    key={choice.status}
                    className={`choice-${choice.status}`}
                  >
                    <input
                      type="radio"
                      name={`insp-${i.key}`}
                      checked={i.status === choice.status}
                      onChange={() =>
                        set(i.key, {
                          status: choice.status,
                          recommendedWork:
                            choice.status === "fix" || choice.status === "watch"
                              ? i.recommendedWork
                              : "",
                        })
                      }
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
              {(i.status === "watch" || i.status === "fix") && (
                <>
                  <label htmlFor={`insp-note-${i.key}`}>
                    Technician findings
                  </label>
                  <textarea
                    id={`insp-note-${i.key}`}
                    rows={2}
                    value={i.note}
                    maxLength={1000}
                    placeholder="Measurements, condition and why it matters"
                    onChange={(e) => set(i.key, { note: e.target.value })}
                  />
                  <label htmlFor={`insp-repair-${i.key}`}>
                    Proposed work{" "}
                    {i.status === "watch" ? "(optional)" : "(required)"}
                  </label>
                  <input
                    id={`insp-repair-${i.key}`}
                    maxLength={200}
                    value={i.recommendedWork ?? ""}
                    placeholder="e.g. Replace front brake pads and rotors"
                    onChange={(e) =>
                      set(i.key, { recommendedWork: e.target.value })
                    }
                  />
                </>
              )}
              {(i.key === "tire_pressure" || i.key === "tire_tread") &&
                i.status !== "na" && (
                  <div className="inspection-readings">
                    <strong>
                      {i.key === "tire_pressure"
                        ? "Tire pressure (PSI)"
                        : "Tread depth (32nds)"}
                    </strong>
                    {(["lf", "rf", "lr", "rr", "spare"] as const).map(
                      (position) => (
                        <label key={position}>
                          {position.toUpperCase()}
                          <input
                            type="number"
                            min="0"
                            inputMode="decimal"
                            value={i.measurements?.[position] ?? ""}
                            onChange={(e) =>
                              set(i.key, {
                                measurements: {
                                  ...i.measurements,
                                  [position]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                )}
              {i.addedToJob && (
                <p className="muted inspection-added">On estimate</p>
              )}
            </fieldset>
          </li>
        ))}
      </ul>
      <nav className="inspection-group-nav" aria-label="Inspection navigation">
        <button
          type="button"
          disabled={sectionIndex === 0}
          onClick={() => setSectionIndex((s) => Math.max(0, s - 1))}
        >
          ← Previous category
        </button>
        <button
          type="button"
          disabled={sectionIndex >= sections.length - 1}
          onClick={() =>
            setSectionIndex((s) => Math.min(sections.length - 1, s + 1))
          }
        >
          Next category →
        </button>
      </nav>
      {!readOnly && !completed && (
        <div className="inspection-submit-actions">
          <button
            type="button"
            className="btn secondary"
            disabled={!ready || pending}
            onClick={() => save(false)}
          >
            Save progress
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || pending || !canSubmit}
            onClick={() => save(true)}
          >
            Submit inspection → Notify advisor
          </button>
        </div>
      )}
      {completed && <p className="notice">Inspection submitted.</p>}
      {!canSubmit && !completed && (
        <p className="muted">
          Confirm {automotive ? "pickup and bay" : "arrival and work area"},
          enter your diagnosis and complete every point before submitting. You
          can save your progress.
        </p>
      )}
      <p role="status">{pending ? "Saving…" : message}</p>
    </div>
  );
}
