"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./desktop-demo.module.css";
import { demoTechnicians, demoTechnicianById } from "./demo-technicians";
import {
  inspectionPoints,
  inspectionRecommendations,
  inspectReady,
  inspectionLabels,
  type InspectionResults,
  type InspectionPointId,
  type InspectionResult,
} from "./inspection-checklist";
import {
  areServiceDocumentsCurrent,
  type SignedItem,
} from "./ro-document-guard";

export type ServiceLine = {
  id: number;
  name: string;
  decision: "approved" | "pending" | "declined";
  price: number;
  cost: number | null;
  notes?: string;
};
export type Stage =
  "intake" | "assignment" | "inspection" | "pricing" | "send" | "authorization";
const stages: { id: Stage; title: string; owner: string }[] = [
  { id: "intake", title: "Advisor Intake", owner: "Service advisor" },
  { id: "assignment", title: "Assign Technician", owner: "Service advisor" },
  { id: "inspection", title: "Diagnosis & Inspection", owner: "Technician" },
  { id: "pricing", title: "Build Estimate", owner: "Service advisor" },
  { id: "send", title: "Customer Estimate", owner: "Service advisor" },
  { id: "authorization", title: "Customer Authorization", owner: "Customer" },
];
type SignatureType = "estimate" | "declination" | "privacy";
type DemoSignature = {
  name: string;
  recordedAt: string;
  version: number;
  items: number[];
  lines: SignedItem[];
};
type Breakdown = {
  partsCost: string;
  partsPrice: string;
  laborCost: string;
  laborPrice: string;
};
type ServiceRecord = {
  stage: Stage;
  complaint: string;
  assignedTech: string;
  assignedTechId: string;
  diagnosis: string;
  inspection: string;
  mediaNotes: string;
  techAccepted: boolean;
  bay: string;
  inspectionResults: InspectionResults;
  handoffs: {
    to: "technician" | "advisor";
    message: string;
    at: string;
    recipientId?: string;
  }[];
  submittedInspectionAt?: string;
  customerExplanation: string;
  findings: string[];
  breakdowns: Record<string, Breakdown>;
  estimateSentAt?: string;
  estimate?: DemoSignature;
  declination?: DemoSignature;
  privacy?: DemoSignature;
  history: string[];
};
const blankBreakdown = (): Breakdown => ({
  partsCost: "",
  partsPrice: "",
  laborCost: "",
  laborPrice: "",
});
const defaults: ServiceRecord = {
  stage: "intake",
  complaint: "",
  assignedTech: "",
  assignedTechId: "",
  diagnosis: "",
  inspection: "",
  mediaNotes: "",
  techAccepted: false,
  bay: "",
  inspectionResults: {},
  handoffs: [],
  customerExplanation: "",
  findings: [],
  breakdowns: {},
  history: [],
};
const keyFor = (ro: string) =>
  `shop-revenue-desktop-demo-service-flow-v1:${ro}`;
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
const numeric = (value: string) => {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && number >= 0
    ? number
    : null;
};
function priced(b: Breakdown) {
  return Object.values(b).every((v) => numeric(v) !== null);
}
function sumPrice(b: Breakdown) {
  return (numeric(b.partsPrice) ?? 0) + (numeric(b.laborPrice) ?? 0);
}
function sumCost(b: Breakdown) {
  return (numeric(b.partsCost) ?? 0) + (numeric(b.laborCost) ?? 0);
}

export function ServiceFlowDemo({
  roId,
  jobs,
  onAddFindings,
  onPriceJob,
  onStageChange,
  onReadyChange,
}: {
  roId: string;
  jobs: ServiceLine[];
  onAddFindings: (findings: { description: string; notes: string }[]) => void;
  onPriceJob: (id: number, cost: number, price: number) => void;
  onStageChange: (stage: Stage) => void;
  onReadyChange: (ready: boolean) => void;
}) {
  const [record, setRecord] = useState<ServiceRecord>(defaults);
  const [loaded, setLoaded] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<SignatureType>("estimate");
  const [signer, setSigner] = useState("");
  const [confirmSign, setConfirmSign] = useState(false);
  const [privacyReviewed, setPrivacyReviewed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    let stored: ServiceRecord | null = null;
    try {
      const raw = sessionStorage.getItem(keyFor(roId));
      if (raw) {
        const parsed = JSON.parse(raw) as ServiceRecord;
        if (
          typeof parsed.complaint === "string" &&
          typeof parsed.assignedTech === "string"
        ) {
          stored = {
            ...defaults,
            ...parsed,
            stage: stages.some((s) => s.id === parsed.stage)
              ? parsed.stage
              : "intake",
            findings: Array.isArray(parsed.findings) ? parsed.findings : [],
            breakdowns: parsed.breakdowns ?? {},
            assignedTechId: parsed.assignedTechId ?? "",
            techAccepted: !!parsed.techAccepted,
            bay: parsed.bay ?? "",
            inspectionResults: parsed.inspectionResults ?? {},
            handoffs: Array.isArray(parsed.handoffs) ? parsed.handoffs : [],
            history: Array.isArray(parsed.history) ? parsed.history : [],
          };
        }
      }
    } catch {
      /* Demo can start with an empty browser session. */
    }
    queueMicrotask(() => {
      if (active) {
        setRecord(stored ?? defaults);
        onStageChange((stored ?? defaults).stage);
        onReadyChange(areServiceDocumentsCurrent(stored ?? defaults, jobs));
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [roId]);

  useEffect(() => {
    if (loaded) onReadyChange(areServiceDocumentsCurrent(record, jobs));
  }, [loaded, record, jobs, onReadyChange]);

  function save(next: ServiceRecord) {
    setRecord(next);
    onStageChange(next.stage);
    onReadyChange(areServiceDocumentsCurrent(next, jobs));
    try {
      sessionStorage.setItem(keyFor(roId), JSON.stringify(next));
    } catch {
      /* Demo only. */
    }
    window.dispatchEvent(new Event("shop-revenue-demo-documents-changed"));
  }
  function saveField(
    field:
      | "complaint"
      | "assignedTech"
      | "diagnosis"
      | "inspection"
      | "mediaNotes"
      | "customerExplanation",
    value: string,
  ) {
    save({
      ...record,
      [field]: value,
      estimateSentAt: undefined,
      estimate: undefined,
      declination: undefined,
      privacy: undefined,
    });
  }
  function advance(to: Stage, description: string) {
    setMessage("");
    const now = new Date().toISOString();
    if (to === "inspection" && !selectedTech) return;
    const handoff =
      to === "inspection"
        ? {
            to: "technician" as const,
            message: `RO ${roId} assigned to ${record.assignedTech}. Pick up vehicle, move to a rack/bay and begin diagnosis and MPI.`,
            recipientId: record.assignedTechId,
            at: now,
          }
        : to === "pricing"
          ? {
              to: "advisor" as const,
              message: `RO ${roId}: technician inspection submitted by ${record.assignedTech}. Build the estimate from diagnosis and recommendations.`,
              at: now,
            }
          : null;
    save({
      ...record,
      stage: to,
      handoffs: handoff ? [...record.handoffs, handoff] : record.handoffs,
      history: [
        ...record.history,
        `${new Date().toLocaleString()} · ${description}`,
        ...(handoff
          ? [`In-app demo notification for ${handoff.to}: ${handoff.message}`]
          : []),
      ],
    });
  }
  function updateInspectionPoint(
    id: InspectionPointId,
    field: "result" | "notes" | "recommendedWork",
    value: string,
  ) {
    const before = record.inspectionResults[id] ?? {
      notes: "",
      recommendedWork: "",
    };
    const next = { ...before, [field]: value };
    if (field === "result" && value !== "service_soon" && value !== "service_now") {
      next.recommendedWork = "";
    }
    save({
      ...record,
      inspectionResults: { ...record.inspectionResults, [id]: next },
    });
  }
  function submitInspection() {
    if (
      !record.techAccepted ||
      !record.bay.trim() ||
      !record.diagnosis.trim() ||
      !inspectReady(record.inspectionResults)
    )
      return;
    const recommendations = inspectionRecommendations(record.inspectionResults);
    const newlyFound = recommendations
      .filter((rec) => !record.findings.includes(rec.name))
      .map((rec) => ({
        description: rec.name,
        notes: `${rec.inspectionArea}: ${rec.notes}`,
      }));
    if (newlyFound.length) onAddFindings(newlyFound);
    const now = new Date().toISOString();
    const handoff = {
      to: "advisor" as const,
      at: now,
      message: `RO ${roId} technician inspection complete. ${recommendations.length} recommendations ready. Build estimate.`,
    };
    save({
      ...record,
      stage: "pricing",
      submittedInspectionAt: now,
      findings: [
        ...new Set([...record.findings, ...recommendations.map((x) => x.name)]),
      ],
      inspection: inspectionPoints
        .map((point) => {
          const item = record.inspectionResults[point.id];
          return `${point.label}: ${item?.result ? inspectionLabels[item.result] : "Not checked"}${item?.notes ? " — " + item.notes : ""}`;
        })
        .join("\n"),
      handoffs: [...record.handoffs, handoff],
      history: [
        ...record.history,
        `Tech ${record.assignedTech} submitted inspection from bay ${record.bay}.`,
        `In-app demo notification for advisor: ${handoff.message}`,
      ],
    });
  }
  const selectedTech = demoTechnicianById(record.assignedTechId);
  const index = stages.findIndex((s) => s.id === record.stage);
  const approved = jobs.filter((j) => j.decision === "approved");
  const declined = jobs.filter((j) => j.decision === "declined");
  const pending = jobs.filter((j) => j.decision === "pending");
  const allPriced =
    jobs.length > 0 &&
    jobs.every(
      (j) =>
        priced(record.breakdowns[String(j.id)] ?? blankBreakdown()) &&
        j.cost !== null &&
        Number.isFinite(j.cost) &&
        Number.isFinite(j.price),
    );
  const documentsCurrent = areServiceDocumentsCurrent(record, jobs);
  // If a recommendation or price changes, older signed documents no longer
  // authorize the new list. The QC gate independently checks exact snapshots.

  const customerLink = `/desktop-demo?screen=customer-link&ro=${encodeURIComponent(roId)}`;
  const quoted = jobs.reduce((n, j) => n + j.price, 0);
  function updateBreakdown(id: number, field: keyof Breakdown, value: string) {
    const prev = record.breakdowns[String(id)] ?? blankBreakdown();
    save({
      ...record,
      breakdowns: {
        ...record.breakdowns,
        [String(id)]: { ...prev, [field]: value },
      },
      estimateSentAt: undefined,
      estimate: undefined,
      declination: undefined,
      privacy: undefined,
    });
  }
  function commitPricing() {
    if (record.stage !== "pricing" || !jobs.length) return;
    const entries = jobs.map((j) => ({
      id: j.id,
      b: record.breakdowns[String(j.id)] ?? blankBreakdown(),
    }));
    if (!entries.every((x) => priced(x.b))) {
      setMessage(
        "Enter all four cost and price fields for each line. Use 0 where appropriate.",
      );
      return;
    }
    for (const { id, b } of entries) onPriceJob(id, sumCost(b), sumPrice(b));
    advance("send", "Advisor priced all diagnosis and inspection items.");
  }
  function recordSignature() {
    if (
      !record.estimateSentAt ||
      record.stage !== "authorization" ||
      !signer.trim() ||
      !confirmSign ||
      pending.length
    )
      return;
    if (selectedDoc === "privacy" && !privacyReviewed) return;
    if (selectedDoc === "declination" && !declined.length) return;
    if (selectedDoc === "estimate" && (!approved.length || !allPriced)) return;
    const lines =
      selectedDoc === "declination"
        ? declined
        : selectedDoc === "estimate"
          ? approved
          : [];
    const signature: DemoSignature = {
      name: signer.trim(),
      recordedAt: new Date().toISOString(),
      version: (record[selectedDoc]?.version ?? 0) + 1,
      items: lines.map((x) => x.id),
      lines: lines.map(({ id, name, price }) => ({ id, name, price })),
    };
    save({
      ...record,
      [selectedDoc]: signature,
      history: [
        ...record.history,
        `${selectedDoc} acknowledged in demo by ${signer.trim()}`,
      ],
    });
    setSigner("");
    setConfirmSign(false);
    setPrivacyReviewed(false);
  }
  function reopenPricing() {
    save({
      ...record,
      stage: "pricing",
      estimateSentAt: undefined,
      estimate: undefined,
      declination: undefined,
      privacy: undefined,
      history: [
        ...record.history,
        "Estimate returned for pricing revision; previous document acknowledgments invalidated.",
      ],
    });
  }
  return (
    <section
      className={styles.panel}
      aria-label="Stage-by-stage service repair workflow"
    >
      <div className={styles.panelHeader}>
        <div>
          <h2>Service workflow</h2>
          <p>
            One stage at a time. Previous records stay saved and out of the way
            until needed.
          </p>
        </div>
        <span
          className={documentsCurrent ? styles.approvedTag : styles.pendingTag}
        >
          {documentsCurrent ? "Authorized" : `Stage ${index + 1} of 6`}
        </span>
      </div>
      {!loaded ? (
        <p className={styles.vehicleEmpty}>Loading workflow…</p>
      ) : (
        <div className={styles.focusedWorkflow}>
          <div className={styles.focusedStageHeader}>
            <span className={styles.eyebrow}>
              {stages[index].owner} · STEP {index + 1} OF 6
            </span>
            <h3>{stages[index].title}</h3>
            <p>
              {record.stage === "intake"
                ? "Record what the customer reports. The RO can wait here until a technician is available."
                : record.stage === "assignment"
                  ? "Assign the technician now or leave this RO waiting. Only this handoff is open."
                  : record.stage === "inspection"
                    ? "The technician diagnoses the concern, completes the inspection and records recommendations with media."
                    : record.stage === "pricing"
                      ? "Every technician recommendation is already listed below. Add parts and labor costs and customer prices."
                      : record.stage === "send"
                        ? "Review the priced proposal and approved media, then share the customer link."
                        : "The customer reviews and decides each line. Collect separate estimate, declination (if needed), and privacy acknowledgments."}
            </p>
          </div>
          {record.stage === "intake" && (
            <div className={styles.focusedStageBody}>
              <label>
                Customer concern, in their words
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={record.complaint}
                  onChange={(e) => saveField("complaint", e.target.value)}
                  placeholder="Customer states the brakes squeal when coming to a stop…"
                />
              </label>
              <button
                type="button"
                className={styles.mobilePrimaryButton}
                disabled={!record.complaint.trim()}
                onClick={() =>
                  advance(
                    "assignment",
                    "Advisor completed intake; awaiting technician assignment.",
                  )
                }
              >
                Save intake → Assign technician
              </button>
            </div>
          )}
          {record.stage === "assignment" && (
            <div className={styles.focusedStageBody}>
              <div className={styles.focusedReadOnly}>
                <strong>Customer concern</strong>
                <p>{record.complaint}</p>
              </div>
              <label>
                Select technician
                <select
                  value={record.assignedTechId}
                  onChange={(e) => {
                    const chosen = demoTechnicianById(e.target.value);
                    save({
                      ...record,
                      assignedTechId: chosen?.id ?? "",
                      assignedTech: chosen?.name ?? "",
                      techAccepted: false,
                      bay: "",
                      estimateSentAt: undefined,
                      estimate: undefined,
                      declination: undefined,
                      privacy: undefined,
                    });
                  }}
                >
                  <option value="">Choose an active technician…</option>
                  {demoTechnicians.map((tech) => (
                    <option key={tech.id} value={tech.id}>
                      {tech.name} · {tech.role}
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.note}>
                Fictional preview roster. The live dropdown must load active
                technicians from this shop and route the task to their user
                account ID.
              </p>
              <button
                type="button"
                className={styles.mobilePrimaryButton}
                disabled={!selectedTech}
                onClick={() =>
                  advance(
                    "inspection",
                    `Assigned technician ${record.assignedTech}; assessment pending.`,
                  )
                }
              >
                Assign → Technician assessment
              </button>
            </div>
          )}
          {record.stage === "inspection" && (
            <div className={styles.focusedStageBody}>
              <div className={styles.workflowAlert} role="status">
                <strong>New technician task · {record.assignedTech}</strong>
                <p>
                  Recipient account: {record.assignedTechId || "Not assigned"}
                </p>
                <p>
                  {record.handoffs.filter((h) => h.to === "technician").at(-1)
                    ?.message ??
                    "Pick up the vehicle, bring it to a bay/rack, and begin assessment."}
                </p>
                <small>
                  In-app demo notification; no device push alert was sent.
                </small>
              </div>
              <div className={styles.focusedReadOnly}>
                <strong>Customer concern</strong>
                <p>{record.complaint}</p>
              </div>
              {!record.techAccepted ? (
                <button
                  type="button"
                  className={styles.mobilePrimaryButton}
                  onClick={() =>
                    save({
                      ...record,
                      techAccepted: true,
                      history: [
                        ...record.history,
                        `Technician ${record.assignedTech} accepted vehicle pickup task.`,
                      ],
                    })
                  }
                >
                  Accept task → Pick up vehicle
                </button>
              ) : (
                <>
                  <label>
                    Vehicle bay / rack
                    <input
                      value={record.bay}
                      onChange={(e) => save({ ...record, bay: e.target.value })}
                      placeholder="e.g. Bay 3 · Lift 2"
                      maxLength={60}
                    />
                  </label>
                  {record.bay.trim() && (
                    <div className={styles.workflowAlert}>
                      <strong>Vehicle in {record.bay}</strong>
                      <p>
                        Complete diagnosis and every point of the inspection
                        before submitting.
                      </p>
                    </div>
                  )}
                  <label>
                    Technician diagnosis and problem verification
                    <textarea
                      rows={3}
                      value={record.diagnosis}
                      onChange={(e) => saveField("diagnosis", e.target.value)}
                      placeholder="Confirmed concern, cause and measurements…"
                    />
                  </label>
                  <div className={styles.inspectionChecklist}>
                    <div className={styles.inspectionChecklistHeader}>
                      <h4>Multi-point inspection</h4>
                      <strong>
                        {
                          inspectionPoints.filter(
                            (p) => record.inspectionResults[p.id]?.result,
                          ).length
                        }{" "}
                        / {inspectionPoints.length} checked
                      </strong>
                    </div>
                    <p>
                      Choose Satisfactory, Service Soon, Service Now, or N/A for each point. Record measurements and findings for concerns; Service Now requires a recommendation.
                    </p>
                    {inspectionPoints.map((point, i) => {
                      const item = record.inspectionResults[point.id] ?? {
                        notes: "",
                        recommendedWork: "",
                      };
                      const lastSection =
                        i === 0 ? null : inspectionPoints[i - 1].section;
                      return (
                        <div className={styles.inspectionItem} key={point.id}>
                          {point.section !== lastSection && (
                            <div className={styles.inspectionCategory}>
                              {point.section}
                            </div>
                          )}
                          <strong>{i + 1}. {point.label}</strong>
                          {point.hint && <p className={styles.inspectionHint}>{point.hint}</p>}
                          <div
                            className={styles.inspectionStatusButtons}
                            role="group"
                            aria-label={`Inspection status: ${point.label}`}
                          >
                            {(
                              [
                                ["satisfactory", "● Satisfactory"],
                                ["service_soon", "▲ Service Soon"],
                                ["service_now", "⬟ Service Now"],
                                ["na", "N/A"],
                              ] as const
                            ).map(([value, label]) => (
                              <button
                                type="button"
                                key={value}
                                aria-pressed={item.result === value}
                                className={
                                  item.result === value
                                    ? styles.inspectionSelected
                                    : ""
                                }
                                onClick={() =>
                                  updateInspectionPoint(
                                    point.id,
                                    "result",
                                    value as InspectionResult,
                                  )
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          {(item.result === "service_soon" ||
                            item.result === "service_now") && (
                            <>
                              <label>
                                What did you find?
                                <textarea
                                  rows={2}
                                  value={item.notes}
                                  onChange={(e) =>
                                    updateInspectionPoint(
                                      point.id,
                                      "notes",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="Measurements, condition, urgency…"
                                />
                              </label>
                              <label>
                                Recommended work (optional for Service Soon, required for Service Now)
                                <input
                                  value={item.recommendedWork}
                                  onChange={(e) =>
                                    updateInspectionPoint(
                                      point.id,
                                      "recommendedWork",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="e.g. Replace front brake pads and rotors"
                                />
                              </label>
                            </>
                          )}
                          {item.result === "satisfactory" && (
                            <label>
                              Notes (optional)
                              <input
                                value={item.notes}
                                onChange={(e) =>
                                  updateInspectionPoint(
                                    point.id,
                                    "notes",
                                    e.target.value,
                                  )
                                }
                                placeholder="Measurements or comments"
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <label>
                    Photo and video notes
                    <textarea
                      rows={2}
                      value={record.mediaNotes}
                      onChange={(e) => saveField("mediaNotes", e.target.value)}
                      placeholder="Identify the photos/video uploaded under this RO"
                    />
                  </label>
                  <p className={styles.note}>
                    Use the RO media panel below for photos and videos. Uploads
                    remain private until an advisor approves sharing. Production
                    upload is not simulated by this inspection form.
                  </p>
                  <button
                    type="button"
                    className={styles.mobilePrimaryButton}
                    disabled={
                      !record.bay.trim() ||
                      !record.diagnosis.trim() ||
                      !inspectReady(record.inspectionResults)
                    }
                    onClick={submitInspection}
                  >
                    Submit inspection → Notify advisor
                  </button>
                  {!inspectReady(record.inspectionResults) && (
                    <p className={styles.journeyNeedChoices}>
                      Every inspection point needs a status. Items needing
                      attention also need technician findings and recommended
                      work.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {record.stage === "pricing" && (
            <div className={styles.focusedStageBody}>
              <div className={styles.workflowAlert} role="status">
                <strong>Advisor notification · Inspection submitted</strong>
                <p>
                  {record.handoffs.filter((h) => h.to === "advisor").at(-1)
                    ?.message ??
                    "Technician submitted diagnosis and inspection. Prepare the estimate."}
                </p>
                <small>
                  In-app demo notification. No email, SMS or device push was
                  sent.
                </small>
              </div>
              <div className={styles.focusedReadOnly}>
                <strong>Technician diagnosis</strong>
                <p>{record.diagnosis}</p>
                <strong>Inspection</strong>
                <p>{record.inspection}</p>
              </div>
              {jobs.map((j) => {
                const b = record.breakdowns[String(j.id)] ?? blankBreakdown();
                return (
                  <div className={styles.focusedPriceItem} key={j.id}>
                    <h4>{j.name}</h4>
                    {j.notes && <p>{j.notes}</p>}
                    <div className={styles.focusedPriceGrid}>
                      {(
                        [
                          ["partsCost", "Parts cost"],
                          ["partsPrice", "Parts price"],
                          ["laborCost", "Labor cost"],
                          ["laborPrice", "Labor price"],
                        ] as const
                      ).map(([field, label]) => (
                        <label key={field}>
                          {label}
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={b[field]}
                            onChange={(e) =>
                              updateBreakdown(j.id, field, e.target.value)
                            }
                            placeholder="0.00"
                          />
                        </label>
                      ))}
                    </div>
                    <div className={styles.focusedItemTotal}>
                      Quoted subtotal <strong>{money(sumPrice(b))}</strong>
                    </div>
                  </div>
                );
              })}
              {!jobs.length && (
                <p>
                  No repair items yet. Return to inspection and add at least one
                  recommendation.
                </p>
              )}
              {message && (
                <p className={styles.checkoutGuardError} role="alert">
                  {message}
                </p>
              )}
              <button
                type="button"
                className={styles.mobilePrimaryButton}
                disabled={
                  !jobs.length ||
                  !jobs.every((j) =>
                    priced(record.breakdowns[String(j.id)] ?? blankBreakdown()),
                  )
                }
                onClick={commitPricing}
              >
                Save pricing → Review & send estimate
              </button>
            </div>
          )}
          {record.stage === "send" && (
            <div className={styles.focusedStageBody}>
              <div className={styles.focusedReadOnly}>
                <strong>Diagnosis to relay</strong>
                <p>{record.diagnosis}</p>
                <strong>Inspection findings</strong>
                <p>{record.inspection}</p>
              </div>
              <label>
                Customer-facing diagnosis and explanation
                <textarea
                  rows={3}
                  value={record.customerExplanation}
                  onChange={(e) =>
                    saveField("customerExplanation", e.target.value)
                  }
                  placeholder="Explain the diagnosis and findings in customer-friendly language. Technician's internal notes stay private."
                />
              </label>

              {jobs.map((j) => (
                <div className={styles.focusedPriceSummary} key={j.id}>
                  <span>{j.name}</span>
                  <strong>{money(j.price)}</strong>
                </div>
              ))}
              <div className={styles.focusedPriceSummary}>
                <strong>Total proposed, before taxes/fees</strong>
                <strong>{money(quoted)}</strong>
              </div>
              <p className={styles.note}>
                Advisor-approved photos/videos will be shown alongside the
                relevant recommendations on the customer preview. Actual sending
                is not wired into the demo.
              </p>
              <Link className={styles.mobileCheckoutLink} href={customerLink}>
                Preview customer link
              </Link>
              <button
                type="button"
                className={styles.mobilePrimaryButton}
                disabled={!record.customerExplanation.trim()}
                onClick={() =>
                  save({
                    ...record,
                    stage: "authorization",
                    estimateSentAt: new Date().toISOString(),
                    history: [
                      ...record.history,
                      "Advisor marked customer proposal shared (demo only; no message was sent).",
                    ],
                  })
                }
              >
                Mark estimate shared (demo) → Customer authorization
              </button>
              <button
                type="button"
                className={styles.mobileTextButton}
                onClick={reopenPricing}
              >
                Revise pricing
              </button>
            </div>
          )}
          {record.stage === "authorization" && (
            <div className={styles.focusedStageBody}>
              <div className={styles.focusedReadOnly}>
                <strong>Customer proposal</strong>
                <p>
                  Marked ready for customer review. Demo send recorded at{" "}
                  {record.estimateSentAt
                    ? new Date(record.estimateSentAt).toLocaleString()
                    : "Not yet sent"}
                  .
                </p>
              </div>
              <Link className={styles.mobileCheckoutLink} href={customerLink}>
                Open customer approval preview
              </Link>
              <div className={styles.serviceDocStatus}>
                <div>
                  <strong>Approved estimate</strong>
                  <span>
                    {record.estimate
                      ? "Acknowledged (demo)"
                      : "Signature pending"}
                  </span>
                </div>
                <div>
                  <strong>Declined work</strong>
                  <span>
                    {!declined.length
                      ? "Not required"
                      : record.declination
                        ? "Acknowledged (demo)"
                        : "Signature pending"}
                  </span>
                </div>
                <div>
                  <strong>Privacy notice</strong>
                  <span>
                    {record.privacy
                      ? "Acknowledged (demo)"
                      : "Signature pending"}
                  </span>
                </div>
              </div>
              <label>
                Document to acknowledge
                <select
                  value={selectedDoc}
                  onChange={(e) => {
                    setSelectedDoc(e.target.value as SignatureType);
                    setConfirmSign(false);
                  }}
                >
                  <option value="estimate">
                    Signed estimate · approved work
                  </option>
                  <option value="declination">
                    Declination · declined recommendations
                  </option>
                  <option value="privacy">Privacy notice</option>
                </select>
              </label>
              <div className={styles.serviceDocPreview}>
                {selectedDoc === "estimate" && (
                  <>
                    <strong>Approved estimate</strong>
                    {approved.map((j) => (
                      <p key={j.id}>
                        {j.name} · {money(j.price)}
                      </p>
                    ))}
                    <p>
                      Authorized subtotal:{" "}
                      {money(approved.reduce((n, j) => n + j.price, 0))}
                    </p>
                  </>
                )}
                {selectedDoc === "declination" && (
                  <>
                    <strong>Declined recommendations</strong>
                    {declined.map((j) => (
                      <p key={j.id}>{j.name} · declined</p>
                    ))}
                    {!declined.length && (
                      <p>Nothing declined. No declination required.</p>
                    )}
                  </>
                )}
                {selectedDoc === "privacy" && (
                  <>
                    <strong>Privacy notice (sample)</strong>
                    <p>
                      Service/contact data is processed for repairs, updates,
                      payments and recordkeeping. The real notice will reflect
                      the shop’s actual data practices and rights.
                    </p>
                    <label className={styles.serviceFlowCheck}>
                      <input
                        type="checkbox"
                        checked={privacyReviewed}
                        onChange={(e) => setPrivacyReviewed(e.target.checked)}
                      />
                      I reviewed the sample notice.
                    </label>
                  </>
                )}
              </div>
              <label>
                Customer name
                <input
                  value={signer}
                  onChange={(e) => setSigner(e.target.value)}
                  placeholder="Customer name"
                />
              </label>
              <label className={styles.serviceFlowCheck}>
                <input
                  type="checkbox"
                  checked={confirmSign}
                  onChange={(e) => setConfirmSign(e.target.checked)}
                />
                I confirm the selected document (demo).
              </label>
              <button
                type="button"
                className={styles.addButton}
                disabled={
                  !confirmSign ||
                  !signer.trim() ||
                  pending.length > 0 ||
                  (selectedDoc === "privacy" && !privacyReviewed) ||
                  (selectedDoc === "estimate" &&
                    (!approved.length || !allPriced)) ||
                  (selectedDoc === "declination" && !declined.length)
                }
                onClick={recordSignature}
              >
                Record {selectedDoc} acknowledgment (demo)
              </button>
              {!!pending.length && (
                <p className={styles.checkoutGuardError}>
                  Customer must approve or decline all lines before the final
                  estimate and declination can be acknowledged.
                </p>
              )}
              {documentsCurrent && (
                <p className={styles.journeyDone}>
                  ✓ All required documents match the current RO. Authorized work
                  may proceed to the technician queue below.
                </p>
              )}
              <button
                type="button"
                className={styles.mobileTextButton}
                onClick={reopenPricing}
              >
                Revise estimate / reissue documents
              </button>
            </div>
          )}
          <details
            className={styles.focusedHistory}
            open={showHistory}
            onToggle={(e) =>
              setShowHistory((e.currentTarget as HTMLDetailsElement).open)
            }
          >
            <summary>Previous steps & activity history</summary>
            <div>
              {stages.slice(0, index).map((s) => (
                <p key={s.id}>✓ {s.title}</p>
              ))}
              {record.history.map((h, i) => (
                <p key={i}>{h}</p>
              ))}
            </div>
          </details>
          <p className={styles.note}>
            Development simulation only. Stages and acknowledgments persist in
            this browser session. No real technician assignment, sending, legal
            signature or document delivery occurs.
          </p>
        </div>
      )}
    </section>
  );
}
