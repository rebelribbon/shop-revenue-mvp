"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  InspectionItem,
  InspectionStatus,
  InspectionAssessment,
} from "@/lib/inspection-templates";
import { saveInspectionAction } from "@/server/actions/inspections";
import { useActionHydration } from "./action-hydration";

// The server continues to store the existing codes; display wording follows
// the four-condition checklist used on a technician's phone.
const CHOICES: { status: InspectionStatus; label: string }[] = [
  { status: "good", label: "Pass" },
  { status: "watch", label: "Caution" },
  { status: "fix", label: "Fail" },
  { status: "na", label: "N/A" },
];
const labelFor = (status: InspectionStatus) =>
  CHOICES.find((choice) => choice.status === status)?.label ?? "Not checked";
const requiresNote = (item: InspectionItem) =>
  item.status === "watch" || item.status === "fix";
const pointReady = (item: InspectionItem) =>
  item.status !== "unchecked" &&
  (!requiresNote(item) || !!item.note.trim()) &&
  (item.status !== "fix" || !!item.recommendedWork?.trim());

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
  // -1 is technician pickup/diagnosis. 0..n-1 are individual inspection
  // checkpoints; n is the review/submit screen.
  const [step, setStep] = useState(() => {
    if (readOnly || completed) return initial.length;
    if (
      !initialAssessment.vehiclePickedUp ||
      !initialAssessment.bay.trim()
    )
      return -1;
    const pending = initial.findIndex((item) => !pointReady(item));
    return pending === -1 ? initial.length : pending;
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const active = step >= 0 && step < items.length ? items[step] : null;
  const checked = items.filter((item) => item.status !== "unchecked").length;
  const canAssess = assessment.vehiclePickedUp && !!assessment.bay.trim();
  const diagnosisReady = !!assessment.diagnosis.trim();
  const canSubmit =
    canAssess && diagnosisReady && items.length > 0 && items.every(pointReady);
  const total = items.length;
  const isReview = step === total;
  const isAssessment = step === -1;
  const sections = [...new Set(items.map((item) => item.section || "Inspection"))];
  const sectionOf = (item: InspectionItem) => item.section || "Inspection";
  const sectionProgress = active
    ? items.filter((item) => sectionOf(item) === sectionOf(active)).filter(
        (item) => item.status !== "unchecked",
      ).length
    : 0;
  const sectionTotal = active
    ? items.filter((item) => sectionOf(item) === sectionOf(active)).length
    : 0;
  const locked = readOnly || completed || !ready || pending;

  function setItem(key: string, patch: Partial<InspectionItem>) {
    setItems((all) =>
      all.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
    setMessage("");
  }

  async function save(submit: boolean): Promise<boolean> {
    if (pending || readOnly || completed || !ready) return false;
    if (submit && !canSubmit) {
      setMessage("Finish all checkpoints and enter your diagnosis before submitting.");
      return false;
    }
    setPending(true);
    setMessage("");
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
      if (!result.ok) {
        setMessage(result.error.message);
        return false;
      }
      setRequestId(crypto.randomUUID());
      setMessage(
        (result.data as { message?: string })?.message ??
          (submit ? "Inspection submitted." : "Progress saved."),
      );
      // Draft saves must not remount this component and reset the technician's
      // place in the checklist. Only submission changes the RO's stage.
      if (submit) router.refresh();
      return true;
    } catch {
      setMessage("Could not save. Your entries are still on this screen; retry.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function goTo(next: number) {
    if (locked) {
      if (readOnly || completed) setStep(next);
      return;
    }
    if (next > step && isAssessment && !canAssess) {
      setMessage("Confirm pickup and choose a bay or rack to begin.");
      return;
    }
    if (next > step && active && !pointReady(active)) {
      setMessage(
        "Select Pass, Caution, Fail or N/A. Caution and Fail require findings; Fail also needs proposed work.",
      );
      return;
    }
    // Each handoff to the next screen is persisted, so a technician can stop
    // and resume hours later or switch devices without losing completed points.
    if (await save(false)) setStep(next);
  }

  return (
    <div className="inspection inspection-wizard" data-ux-ready={ready}>
      <div className="inspection-section-header">
        <p className="muted">
          {automotive ? "Vehicle inspection" : "Service inspection"} · {checked}/{total} complete
        </p>
        <progress max={Math.max(total, 1)} value={checked} style={{ width: "100%" }}>
          {checked} of {total}
        </progress>
        <h3>
          {isAssessment
            ? automotive
              ? "Start inspection"
              : "Start assessment"
            : isReview
              ? "Finish and submit"
              : (active?.section || "Inspection")}
        </h3>
        {active && (
          <p className="muted">
            Checkpoint {step + 1} of {total} · {sectionProgress} of {sectionTotal} in this section
          </p>
        )}
      </div>

      {isAssessment && (
        <fieldset disabled={locked}>
          <legend>{automotive ? "1. Pick up the vehicle" : "1. Begin service"}</legend>
          <p>Confirm where you are working. You can record your diagnosis after inspecting the vehicle.</p>
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
              ? "I have picked up the vehicle for diagnosis"
              : "I have arrived at the service location"}
          </label>
          <label htmlFor={"inspection-bay-" + jobId}>
            {automotive ? "Bay / rack" : "Work area"}
          </label>
          <input
            id={"inspection-bay-" + jobId}
            maxLength={120}
            required
            value={assessment.bay}
            placeholder={automotive ? "Rack 2" : "Work area"}
            onChange={(event) =>
              setAssessment((current) => ({ ...current, bay: event.target.value }))
            }
          />

        </fieldset>
      )}

      {active && (
        <section className={"inspection-item is-" + active.status}>
          <fieldset disabled={locked}>
            <legend><strong>{active.label}</strong></legend>
            <p className="muted">Select the condition of this item.</p>
            {active.hint && <p className="muted">{active.hint}</p>}
            <div className="inspection-choices" aria-label={"Condition: " + active.label}>
              {CHOICES.map((choice) => (
                <label key={choice.status} className={"choice-" + choice.status}>
                  <input
                    type="radio"
                    name={"insp-" + active.key}
                    checked={active.status === choice.status}
                    onChange={() =>
                      setItem(active.key, {
                        status: choice.status,
                        recommendedWork:
                          choice.status === "fix" || choice.status === "watch"
                            ? active.recommendedWork
                            : "",
                      })
                    }
                  />
                  {choice.label}
                </label>
              ))}
            </div>
            {requiresNote(active) && (
              <>
                <label htmlFor={"insp-note-" + active.key}>Technician findings (required)</label>
                <textarea
                  id={"insp-note-" + active.key}
                  rows={3}
                  maxLength={1000}
                  required
                  value={active.note}
                  placeholder="What is worn, damaged, leaking, or outside specification?"
                  onChange={(event) => setItem(active.key, { note: event.target.value })}
                />
                <label htmlFor={"insp-repair-" + active.key}>
                  Recommended repair {active.status === "watch" ? "(optional)" : "(required)"}
                </label>
                <input
                  id={"insp-repair-" + active.key}
                  maxLength={200}
                  required={active.status === "fix"}
                  value={active.recommendedWork ?? ""}
                  placeholder="Example: Replace front brake pads and rotors"
                  onChange={(event) =>
                    setItem(active.key, { recommendedWork: event.target.value })
                  }
                />
              </>
            )}
            {(active.key === "tire_pressure" || active.key === "tire_tread") &&
              active.status !== "na" && (
                <div className="inspection-readings">
                  <strong>
                    {active.key === "tire_pressure"
                      ? "Tire pressure (PSI)"
                      : "Tread depth (32nds)"}
                  </strong>
                  {(["lf", "rf", "lr", "rr", "spare"] as const).map((position) => (
                    <label key={position}>
                      {position.toUpperCase()}
                      <input
                        type="number"
                        min="0"
                        inputMode="decimal"
                        value={active.measurements?.[position] ?? ""}
                        onChange={(event) =>
                          setItem(active.key, {
                            measurements: {
                              ...active.measurements,
                              [position]: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            {(active.status === "watch" || active.status === "fix") && (
              <a className="btn secondary" href={`/app/jobs?job=${jobId}&mode=technician#technician-media`}>
                Add photo or video of this finding
              </a>
            )}
          </fieldset>
        </section>
      )}

      {isReview && (
        <section className="inspection-review" aria-label="Inspection review">
          <p>
            <strong>Pass:</strong> {items.filter((i) => i.status === "good").length}
            {" · "}<strong>Caution:</strong> {items.filter((i) => i.status === "watch").length}
            {" · "}<strong>Fail:</strong> {items.filter((i) => i.status === "fix").length}
            {" · "}<strong>N/A:</strong> {items.filter((i) => i.status === "na").length}
          </p>
          <label htmlFor={`inspection-diagnosis-${jobId}`}>
            <strong>Technician diagnosis</strong> (required before submission)
          </label>
          {readOnly || completed ? (
            <p>{assessment.diagnosis || "No diagnosis recorded."}</p>
          ) : (
            <textarea
              id={`inspection-diagnosis-${jobId}`}
              rows={4}
              maxLength={4000}
              required
              value={assessment.diagnosis}
              placeholder="Describe the customer's concern, tests, and findings."
              onChange={(event) =>
                setAssessment((current) => ({
                  ...current,
                  diagnosis: event.target.value,
                }))
              }
            />
          )}
          <p className="muted">Review the flagged items and submit to the assigned advisor.</p>
          {sections.map((section) => (
            <details key={section}>
              <summary>{section}</summary>
              <ul className="inspection-list">
                {items.map((item, index) =>
                  (item.section || "Inspection") === section ? (
                    <li key={item.key}>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setStep(index)}
                        disabled={pending}
                      >
                        {index + 1}. {item.label} — {labelFor(item.status)}
                      </button>
                      {item.note && <p className="muted">{item.note}</p>}
                      {item.recommendedWork && (
                        <p className="muted">Recommended: {item.recommendedWork}</p>
                      )}
                    </li>
                  ) : null,
                )}
              </ul>
            </details>
          ))}
          {!canSubmit && !completed && (
            <p className="notice" role="alert">
              Complete any unfinished checkpoints and enter a diagnosis before submitting.
            </p>
          )}
        </section>
      )}

      {!completed && !readOnly && (
        <div className="inspection-submit-actions">
          <button
            type="button"
            className="btn secondary"
            disabled={!ready || pending}
            onClick={() => void save(false)}
          >
            Save progress
          </button>
          <nav className="inspection-group-nav" aria-label="Inspection steps">
            {step > -1 && (
              <button
                type="button"
                className="btn secondary"
                disabled={!ready || pending}
                onClick={() => void goTo(step - 1)}
              >
                Previous
              </button>
            )}
            {!isReview ? (
              <button
                type="button"
                className="btn primary"
                disabled={!ready || pending || (isAssessment ? !canAssess : !active || !pointReady(active))}
                onClick={() => void goTo(step + 1)}
              >
                {isAssessment
                  ? "Begin 40-point inspection"
                  : active && step === total - 1
                    ? "Review and submit"
                    : "Save · Next checkpoint"}
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={!ready || pending || !canSubmit}
                onClick={() => void save(true)}
              >
                Submit to service advisor
              </button>
            )}
          </nav>
        </div>
      )}
      {(readOnly || completed) && active && (
        <button type="button" className="btn secondary" onClick={() => setStep(total)}>
          Back to inspection summary
        </button>
      )}
      {completed && <p className="notice ok">Inspection submitted to the advisor.</p>}
      <p role="status">{pending ? "Saving…" : message}</p>
    </div>
  );
}
