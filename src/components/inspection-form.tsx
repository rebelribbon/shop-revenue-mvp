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
import { MediaUploader } from "./media-uploader";

const CONDITIONS: { value: InspectionStatus; label: string }[] = [
  { value: "good", label: "Pass" },
  { value: "watch", label: "Caution" },
  { value: "fix", label: "Fail" },
  { value: "na", label: "N/A" },
];
const conditionLabel = (status: InspectionStatus) =>
  CONDITIONS.find((c) => c.value === status)?.label ?? "Unchecked";
const needsFindings = (item: InspectionItem) =>
  item.status === "watch" || item.status === "fix";
const pointComplete = (item: InspectionItem) =>
  item.status !== "unchecked" &&
  (!needsFindings(item) || !!item.note.trim()) &&
  (item.status !== "fix" || !!item.recommendedWork?.trim());
const sectionName = (item: InspectionItem) => item.section || "Inspection";

export function InspectionForm({
  jobId,
  customerId,
  vehicleId,
  serviceAssetId,
  initial,
  readOnly,
  completed = false,
  initialAssessment,
  automotive = true,
}: {
  jobId: string;
  customerId: string;
  vehicleId?: string | null;
  serviceAssetId?: string | null;
  initial: InspectionItem[];
  readOnly: boolean;
  completed?: boolean;
  initialAssessment: InspectionAssessment;
  automotive?: boolean;
}) {
  const router = useRouter();
  const ready = useActionHydration();
  const [items, setItems] = useState(initial);
  const [assessment, setAssessment] = useState(initialAssessment);
  const sections = [...new Set(initial.map(sectionName))];
  // One screen per VEHICLE SYSTEM, not one screen per checklist point.
  // -1: pickup; 0..N-1: system inspection; N: final review.
  const [step, setStep] = useState(() => {
    if (readOnly || completed) return sections.length;
    if (!initialAssessment.vehiclePickedUp || !initialAssessment.bay.trim())
      return -1;
    const nextSection = sections.findIndex((name) =>
      initial.some((item) => sectionName(item) === name && !pointComplete(item)),
    );
    return nextSection === -1 ? sections.length : nextSection;
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const review = step === sections.length;
  const pickup = step === -1;
  const activeSection = sections[step] ?? null;
  const activeItems = items.filter((item) => sectionName(item) === activeSection);
  const checked = items.filter((item) => item.status !== "unchecked").length;
  const allComplete = items.length > 0 && items.every(pointComplete);
  const pickupComplete = assessment.vehiclePickedUp && !!assessment.bay.trim();
  const canSubmit = pickupComplete && !!assessment.diagnosis.trim() && allComplete;
  const canEdit = !readOnly && !completed;
  const disabled = !ready || pending || !canEdit;
  const sectionReady = activeItems.length > 0 && activeItems.every(pointComplete);

  function update(key: string, changes: Partial<InspectionItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
    setMessage("");
  }

  async function persist(submit: boolean) {
    if (!canEdit || !ready || pending) return false;
    if (submit && !canSubmit) {
      setMessage("Complete every checklist item and add your diagnosis before submission.");
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
      setMessage(submit ? "Inspection submitted to the advisor." : "Progress saved.");
      if (submit) router.refresh();
      return true;
    } catch {
      setMessage("Could not save. Your answers remain here. Please retry.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function next() {
    if (pickup && !pickupComplete) {
      setMessage("Confirm pickup and enter the rack or bay.");
      return;
    }
    if (activeSection && !sectionReady) {
      setMessage("Complete each item in this section. Caution and Fail need findings; Fail also needs a repair recommendation.");
      return;
    }
    if (await persist(false)) setStep((current) => current + 1);
  }

  return (
    <div className="inspection inspection-wizard" data-ux-ready={ready}>
      <header className="inspection-section-header">
        <p className="muted">
          {automotive ? "Vehicle inspection" : "Service inspection"} · {checked} of {items.length} checked
        </p>
        <progress
          value={checked}
          max={Math.max(items.length, 1)}
          aria-label="Inspection completion"
          style={{ width: "100%" }}
        />
        <h3>
          {pickup
            ? automotive ? "Pick up vehicle" : "Arrive at job"
            : review
              ? "Review and submit"
              : activeSection}
        </h3>
        {activeSection && (
          <p className="muted">
            System {step + 1} of {sections.length} · {activeItems.filter((item) => item.status !== "unchecked").length}/{activeItems.length} checked
          </p>
        )}
      </header>

      {pickup && (
        <fieldset disabled={disabled}>
          <p>Start here. The inspection and diagnosis are completed at the vehicle.</p>
          <label>
            <input
              type="checkbox"
              checked={assessment.vehiclePickedUp}
              onChange={(e) =>
                setAssessment((a) => ({ ...a, vehiclePickedUp: e.target.checked }))
              }
            />
            {automotive ? "I have the vehicle" : "I am at the job"}
          </label>
          <label htmlFor={`inspection-bay-${jobId}`}>
            {automotive ? "Rack / bay" : "Work area"}
          </label>
          <input
            id={`inspection-bay-${jobId}`}
            required
            maxLength={120}
            placeholder={automotive ? "Bay 2" : "Work area"}
            value={assessment.bay}
            onChange={(e) => setAssessment((a) => ({ ...a, bay: e.target.value }))}
          />
        </fieldset>
      )}

      {activeSection && (
        <section aria-label={activeSection} className="inspection-system">
          <p className="muted">Mark each item. Add details only when something needs attention.</p>
          {activeItems.map((item) => (
            <div key={item.key} className={`inspection-point is-${item.status}`}>
              <fieldset disabled={disabled}>
                <legend><strong>{item.label}</strong></legend>
                {item.hint && <p className="muted">{item.hint}</p>}
                <div className="inspection-choices" aria-label={`Condition for ${item.label}`}>
                  {CONDITIONS.map((condition) => (
                    <label key={condition.value} className={`choice-${condition.value}`}>
                      <input
                        type="radio"
                        name={`insp-${item.key}`}
                        checked={item.status === condition.value}
                        onChange={() =>
                          update(item.key, {
                            status: condition.value,
                            note: condition.value === "good" || condition.value === "na"
                              ? "" : item.note,
                            recommendedWork:
                              condition.value === "good" || condition.value === "na"
                                ? "" : item.recommendedWork,
                          })
                        }
                      />
                      {condition.label}
                    </label>
                  ))}
                </div>
                {needsFindings(item) && (
                  <div className="inspection-point-findings">
                    <label htmlFor={`insp-note-${item.key}`}>What did you find? *</label>
                    <textarea
                      id={`insp-note-${item.key}`}
                      rows={2}
                      maxLength={1000}
                      required
                      placeholder="Describe the condition or measurement"
                      value={item.note}
                      onChange={(e) => update(item.key, { note: e.target.value })}
                    />
                    <label htmlFor={`insp-repair-${item.key}`}>
                      Recommended work {item.status === "fix" ? "*" : "(optional)"}
                    </label>
                    <input
                      id={`insp-repair-${item.key}`}
                      required={item.status === "fix"}
                      maxLength={200}
                      placeholder="Example: Replace front pads"
                      value={item.recommendedWork ?? ""}
                      onChange={(e) =>
                        update(item.key, { recommendedWork: e.target.value })
                      }
                    />
                    <details className="inspection-evidence">
                      <summary>Found an issue — add a photo? (optional)</summary>
                      <MediaUploader
                        purpose="finding"
                        customerId={customerId}
                        jobId={jobId}
                        vehicleId={vehicleId}
                        serviceAssetId={serviceAssetId}
                        inspectionItemKey={item.key}
                        inspectionItemLabel={item.label}
                      />
                    </details>
                  </div>
                )}
                {(item.key === "tire_pressure" || item.key === "tire_tread") &&
                  item.status !== "na" && item.status !== "unchecked" && (
                    <div className="inspection-readings">
                      <p><strong>{item.key === "tire_pressure" ? "PSI" : "Tread depth (32nds)"}</strong></p>
                      {(["lf", "rf", "lr", "rr", "spare"] as const).map((position) => (
                        <label key={position}>
                          {position.toUpperCase()}
                          <input
                            type="number"
                            min="0"
                            inputMode="decimal"
                            value={item.measurements?.[position] ?? ""}
                            onChange={(e) =>
                              update(item.key, {
                                measurements: {
                                  ...item.measurements,
                                  [position]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
              </fieldset>
            </div>
          ))}
        </section>
      )}

      {review && (
        <section className="inspection-review" aria-label="Review inspection">
          <p>
            <strong>Pass:</strong> {items.filter((i) => i.status === "good").length}
            {" · "}<strong>Caution:</strong> {items.filter((i) => i.status === "watch").length}
            {" · "}<strong>Fail:</strong> {items.filter((i) => i.status === "fix").length}
            {" · "}<strong>N/A:</strong> {items.filter((i) => i.status === "na").length}
          </p>
          <label htmlFor={`inspection-diagnosis-${jobId}`}>Technician diagnosis</label>
          {canEdit ? (
            <textarea
              id={`inspection-diagnosis-${jobId}`}
              rows={4}
              required
              maxLength={4000}
              placeholder="Concern, tests completed, findings and conclusion"
              value={assessment.diagnosis}
              onChange={(e) =>
                setAssessment((a) => ({ ...a, diagnosis: e.target.value }))
              }
              disabled={!ready || pending}
            />
          ) : (
            <p>{assessment.diagnosis || "No diagnosis recorded."}</p>
          )}
          {sections.map((name, index) => {
            const group = items.filter((item) => sectionName(item) === name);
            const flagged = group.filter(needsFindings);
            return (
              <details key={name}>
                <summary>
                  {name} · {group.filter(pointComplete).length}/{group.length} complete
                </summary>
                {group.map((item) => (
                  <p key={item.key}>
                    <strong>{item.label}</strong>: {conditionLabel(item.status)}
                    {item.note ? ` — ${item.note}` : ""}
                    {item.recommendedWork ? ` · ${item.recommendedWork}` : ""}
                  </p>
                ))}
                {canEdit && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setStep(index)}
                    disabled={pending}
                  >
                    Edit {name}
                  </button>
                )}
                {flagged.length > 0 && <p className="muted">{flagged.length} item(s) flagged</p>}
              </details>
            );
          })}
          <section className="inspection-summary-video">
            <h4>One-minute technician video (optional)</h4>
            <p className="muted">
              Introduce yourself, briefly explain what passed and the items
              needing attention, and direct questions to the service advisor.
              The advisor reviews the video before it is shared.
            </p>
            {canEdit && (
              <MediaUploader
                purpose="walkaround"
                customerId={customerId}
                jobId={jobId}
                vehicleId={vehicleId}
                serviceAssetId={serviceAssetId}
              />
            )}
          </section>
          {!canSubmit && canEdit && (
            <p role="alert" className="notice">
              Finish unchecked items, required findings, and the technician diagnosis.
            </p>
          )}
        </section>
      )}

      {canEdit && (
        <footer className="inspection-submit-actions">
          <nav className="inspection-group-nav" aria-label="Inspection steps">
            {step > -1 && (
              <button
                className="btn secondary"
                type="button"
                onClick={() => setStep((current) => current - 1)}
                disabled={!ready || pending}
              >
                Back
              </button>
            )}
            {review ? (
              <button
                className="btn primary"
                type="button"
                disabled={!ready || pending || !canSubmit}
                onClick={() => void persist(true)}
              >
                Submit inspection to advisor
              </button>
            ) : (
              <button
                className="btn primary"
                type="button"
                disabled={!ready || pending || (pickup ? !pickupComplete : !sectionReady)}
                onClick={() => void next()}
              >
                {pickup
                  ? "Start inspection"
                  : step === sections.length - 1
                    ? "Review inspection"
                    : "Save and continue"}
              </button>
            )}
          </nav>
          <button
            type="button"
            className="btn secondary"
            disabled={!ready || pending}
            onClick={() => void persist(false)}
          >
            Save and finish later
          </button>
        </footer>
      )}
      {completed && <p className="notice ok">Inspection submitted to the advisor.</p>}
      <p role="status">{pending ? "Saving progress…" : message}</p>
    </div>
  );
}
