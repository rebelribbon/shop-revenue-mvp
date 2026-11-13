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
      !initialAssessment.bay.trim() ||
      !initialAssessment.diagnosis.trim()
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
  const canAssess =
    assessment.vehiclePickedUp &&
    !!assessment.bay.trim() &&
    !!assessment.diagnosis.trim();
  const canSubmit = canAssess && items.length > 0 && items.every(pointReady);
  const total = items.length;
  const isReview = step === total;
  const isAssessment = step === -1;
  const sections = [...new Set(items.map((item) => item.section || "Inspection"))];
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
      setMessage("Complete your diagnosis and all 40 points before submitting.");
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
      setMessage("Confirm vehicle pickup, record the bay, and enter your diagnosis.");
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
    <div className="inspection" data-ux-ready={ready}>
      <div className="inspection-section-header">
        <p>
          <strong>{automotive ? "40-point vehicle inspection" : "Service inspection"}</strong>
          {" · "}{checked} of {total} checked
        </p>
        <progress max={Math.max(total, 1)} value={checked} style={{ width: "100%" }}>
          {checked} of {total}
        </progress>
        <h3>
          {isAssessment
            ? automotive
              ? "Step 1 · Pickup and diagnosis"
              : "Step 1 · Arrival and assessment"
            : isReview
              ? "Review inspection"
              : "Point " + (step + 1) + " of " + total + " · " +
                (active?.section || "Inspection")}
        </h3>
      </div>

      {isAssessment && (
        <fieldset disabled={locked}>
          <legend>{automotive ? "Vehicle pickup" : "Service arrival"}</legend>
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
          <label htmlFor={"inspection-diagnosis-" + jobId}>Technician diagnosis</label>
          <textarea
            id={"inspection-diagnosis-" + jobId}
            rows={4}
            maxLength={4000}
            required
            value={assessment.diagnosis}
            placeholder="Describe the concern, symptoms, tests and initial findings."
            onChange={(event) =>
              setAssessment((current) => ({
                ...current,
                diagnosis: event.target.value,
              }))
            }
          />
        </fieldset>
      )}

      {active && (
        <section className={"inspection-item is-" + active.status}>
          <fieldset disabled={locked}>
            <legend><strong>{active.label}</strong></legend>
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
            <p className="muted">
              {active.addedToJob ? "Already included in the estimate." :
                "Photos and videos can be added in Technician media on this RO."}
            </p>
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
          <p className="muted">
            {assessment.diagnosis || "Technician diagnosis is not yet recorded."}
          </p>
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
              Finish any unchecked or incomplete points before submitting.
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
                {active && step === total - 1
                  ? "Review inspection"
                  : "Save and next"}
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={!ready || pending || !canSubmit}
                onClick={() => void save(true)}
              >
                Submit inspection · Notify advisor
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
