"use client";

import { useEffect, useState } from "react";
import styles from "./desktop-demo.module.css";
import { ShareMediaDemo } from "./customer-media";
import { AdvisorCheckoutDemo } from "./ro-checkout-demo";

export type Decision = "approved" | "pending" | "declined";
export type DemoJob = {
  id: number;
  name: string;
  price: number;
  cost: number | null;
  decision: Decision;
  removalReason?: string;
  origin?: "requested" | "inspection";
  notes?: string;
  addedInDemo?: boolean;
};
const initialJobs: DemoJob[] = [
  {
    id: 1,
    name: "Front brake pads and rotors",
    price: 425,
    cost: 175,
    decision: "approved",
  },
  {
    id: 2,
    name: "Brake fluid flush",
    price: 180,
    cost: 55,
    decision: "pending",
  },
  {
    id: 3,
    name: "Multi-point inspection",
    price: 80,
    cost: 20,
    decision: "approved",
  },
  {
    id: 4,
    name: "Cabin air filter replacement",
    price: 65,
    cost: 18,
    decision: "declined",
  },
];
export const roRecords = {
  "RO-10482": {
    title: "Brake Service",
    vehicle: "2021 Ford F-150 · VIN ending 4821",
    jobs: initialJobs,
  },
  "RO-10193": {
    title: "Oil Change & Inspection",
    vehicle: "2021 Ford F-150 · VIN ending 4821",
    jobs: [
      {
        id: 1,
        name: "Engine oil and filter change",
        price: 115,
        cost: 42,
        decision: "approved",
      },
      {
        id: 2,
        name: "Tire rotation",
        price: 45,
        cost: 12,
        decision: "approved",
      },
      {
        id: 3,
        name: "Air filter replacement",
        price: 55,
        cost: 16,
        decision: "declined",
      },
    ] satisfies DemoJob[],
  },
  "RO-09914": {
    title: "Battery Replacement",
    vehicle: "2018 Honda Accord · VIN ending 9134",
    jobs: [
      {
        id: 1,
        name: "Battery replacement",
        price: 285,
        cost: 112,
        decision: "approved",
      },
      {
        id: 2,
        name: "Charging system diagnostic",
        price: 89,
        cost: 26,
        decision: "approved",
      },
      {
        id: 3,
        name: "Clean corroded terminals",
        price: 35,
        cost: 8,
        decision: "pending",
      },
    ] satisfies DemoJob[],
  },
} as const;
type RoId = string;
const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );

export function RoWorkspace({
  internal,
  roId,
  vehicleId,
  newTitle,
}: {
  internal: boolean;
  roId: RoId;
  vehicleId?: string;
  newTitle?: string;
}) {
  const existing = roRecords[roId as keyof typeof roRecords];
  const ro = existing ?? {
    title: newTitle || "New Repair Order",
    vehicle:
      vehicleId === "accord"
        ? "2018 Honda Accord · VIN ending 9134"
        : "2021 Ford F-150 · VIN ending 4821",
    jobs: [] as DemoJob[],
  };
  const storageKey = `shop-revenue-desktop-demo-ro-v2:${roId}`;
  const [jobs, setJobs] = useState<DemoJob[]>(() => [...ro.jobs]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [origin, setOrigin] = useState<"requested" | "inspection">(
    "inspection",
  );
  const [notes, setNotes] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [nextId, setNextId] = useState(
    () => Math.max(0, ...ro.jobs.map((job) => job.id)) + 1,
  );
  const [restored, setRestored] = useState(false);
  const [removalId, setRemovalId] = useState<number | null>(null);
  const [removalReason, setRemovalReason] = useState(
    "Customer changed their mind",
  );

  useEffect(() => {
    let cancelled = false;
    let previous: DemoJob[] | null = null;
    let customerChoices: Record<string, Decision> = {};
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              typeof item.id === "number" &&
              typeof item.name === "string" &&
              typeof item.price === "number" &&
              (item.cost === null || typeof item.cost === "number") &&
              ["approved", "pending", "declined"].includes(item.decision),
          )
        ) {
          previous = parsed as DemoJob[];
        }
      }
      const customerRaw = sessionStorage.getItem(
        `shop-revenue-desktop-demo-customer-choices-v1:${roId}`,
      );
      if (customerRaw) {
        const choices: unknown = JSON.parse(customerRaw);
        if (choices && typeof choices === "object" && !Array.isArray(choices)) {
          customerChoices = Object.fromEntries(
            Object.entries(choices).filter(
              ([id, v]) =>
                Number.isSafeInteger(Number(id)) &&
                (v === "approved" || v === "declined"),
            ),
          ) as Record<string, Decision>;
        }
      }
    } catch {
      // The preview still works with built-in sample data when storage is unavailable.
    }
    // Defer React state updates until after the effect setup.
    queueMicrotask(() => {
      if (cancelled) return;
      const merged = (previous ?? [...ro.jobs]).map((job) => {
        const customerDecision = customerChoices[String(job.id)];
        return customerDecision ? { ...job, decision: customerDecision } : job;
      });
      setJobs(merged);
      setNextId(Math.max(0, ...merged.map((item) => item.id)) + 1);
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(jobs));
    } catch {
      // Session persistence is only a preview convenience.
    }
  }, [jobs, restored, storageKey]);
  const approved = jobs.filter((job) => job.decision === "approved");
  const recommendations = jobs.filter((job) => job.decision !== "approved");
  const approvedTotal = approved.reduce((sum, job) => sum + job.price, 0);
  const suggestedTotal = recommendations.reduce(
    (sum, job) => sum + job.price,
    0,
  );
  const costKnown = approved.every((job) => job.cost !== null);
  const approvedCosts = approved.reduce((sum, job) => sum + (job.cost ?? 0), 0);
  function setDecision(id: number, decision: Decision) {
    setJobs((old) =>
      old.map((job) => (job.id === id ? { ...job, decision } : job)),
    );
  }
  function removeApprovedJob() {
    if (removalId === null) return;
    setJobs((old) =>
      old.map((job) =>
        job.id === removalId
          ? { ...job, decision: "declined", removalReason }
          : job,
      ),
    );
    setRemovalId(null);
    setRemovalReason("Customer changed their mind");
  }
  function addJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(price);
    const internalCost = cost.trim() === "" ? null : Number(cost);
    if (
      !name.trim() ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      !/^(?:\d+)(?:\.\d{1,2})?$/.test(price) ||
      (cost.trim() !== "" &&
        (!Number.isFinite(internalCost) ||
          internalCost === null ||
          internalCost < 0 ||
          !/^(?:\d+)(?:\.\d{1,2})?$/.test(cost)))
    ) {
      setError(
        "Enter a job description and a valid customer price (up to two decimals).",
      );
      return;
    }
    if (editId !== null) {
      setJobs((old) =>
        old.map((job) =>
          job.id === editId && job.decision === "pending" && job.addedInDemo
            ? {
                ...job,
                name: name.trim(),
                price: amount,
                cost: internalCost,
                origin,
                notes: notes.trim(),
              }
            : job,
        ),
      );
    } else {
      setJobs((old) => [
        ...old,
        {
          id: nextId,
          name: name.trim(),
          price: amount,
          cost: internalCost,
          decision: "pending",
          origin,
          notes: notes.trim(),
          addedInDemo: true,
        },
      ]);
      setNextId((id) => id + 1);
    }
    setName("");
    setPrice("");
    setCost("");
    setNotes("");
    setOrigin("inspection");
    setEditId(null);
    setError("");
    setShowAdd(false);
  }
  function beginEdit(job: DemoJob) {
    if (job.decision !== "pending" || !job.addedInDemo) return;
    setEditId(job.id);
    setName(job.name);
    setPrice(String(job.price));
    setCost(job.cost === null ? "" : String(job.cost));
    setOrigin(job.origin ?? "inspection");
    setNotes(job.notes ?? "");
    setShowAdd(true);
    setError("");
  }
  function deleteDraftJob() {
    if (deleteId === null) return;
    setJobs((old) =>
      old.filter(
        (job) =>
          !(
            job.id === deleteId &&
            job.decision === "pending" &&
            job.addedInDemo
          ),
      ),
    );
    setDeleteId(null);
  }
  function closeEditor() {
    setShowAdd(false);
    setEditId(null);
    setName("");
    setPrice("");
    setCost("");
    setNotes("");
    setOrigin("inspection");
    setError("");
  }
  function jobTable(items: DemoJob[], proposed: boolean) {
    return (
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Job / Service</th>
              <th>Customer price</th>
              <th>Status</th>
              {internal && (
                <>
                  <th>Internal cost</th>
                  <th>Gross profit</th>
                </>
              )}
              <th>{proposed ? "Demo decision" : "Manage approval"}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((job) => (
              <tr key={job.id}>
                <td>
                  <strong>{job.name}</strong>
                  {job.origin && (
                    <small className={styles.removalNote}>
                      {job.origin === "requested"
                        ? "Customer-requested"
                        : "Inspection finding"}
                    </small>
                  )}
                  {job.notes && (
                    <small className={styles.removalNote}>{job.notes}</small>
                  )}
                </td>
                <td>{money(job.price)}</td>
                <td>
                  <span
                    className={
                      job.decision === "approved"
                        ? styles.approvedTag
                        : job.decision === "declined"
                          ? styles.declinedTag
                          : styles.pendingTag
                    }
                  >
                    {job.decision === "approved"
                      ? "Approved"
                      : job.decision === "declined"
                        ? "Declined"
                        : "Awaiting approval"}
                  </span>
                  {job.removalReason && (
                    <small className={styles.removalNote}>
                      Removed: {job.removalReason}
                    </small>
                  )}
                </td>
                {internal && (
                  <>
                    <td>{job.cost === null ? "Unknown" : money(job.cost)}</td>
                    <td>
                      {job.cost === null
                        ? "Unknown"
                        : money(job.price - job.cost)}
                    </td>
                  </>
                )}
                {!proposed && (
                  <td>
                    <button
                      type="button"
                      className={styles.removeApprovalButton}
                      onClick={() => {
                        setRemovalId(job.id);
                        setRemovalReason("Customer changed their mind");
                      }}
                    >
                      Remove from approved
                    </button>
                  </td>
                )}
                {proposed && (
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        onClick={() => setDecision(job.id, "approved")}
                      >
                        Approve (demo)
                      </button>
                      {job.decision !== "declined" && (
                        <button
                          type="button"
                          onClick={() => setDecision(job.id, "declined")}
                        >
                          Decline (demo)
                        </button>
                      )}
                      {job.decision === "pending" && job.addedInDemo && (
                        <>
                          <button type="button" onClick={() => beginEdit(job)}>
                            Edit draft
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteId(job.id)}
                          >
                            Delete draft
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={internal ? 6 : 4} className={styles.emptyState}>
                  {proposed
                    ? "No unapproved recommendations."
                    : "No work has been approved yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <>
      <div className={styles.roHead}>
        <div>
          <div className={styles.eyebrow}>REPAIR ORDER · {roId}</div>
          <h2>{ro.title}</h2>
          <p>{ro.vehicle}</p>
        </div>
        <div className={styles.roActions}>
          <span className={styles.pill}>In progress</span>
          <button
            type="button"
            className={styles.addButton}
            onClick={() => {
              if (showAdd) closeEditor();
              else setShowAdd(true);
            }}
            aria-expanded={showAdd}
            aria-controls="new-demo-job"
          >
            + Add Work / Recommendation
          </button>
        </div>
      </div>
      <div className={styles.tabs}>
        <strong>Overview</strong>
        <a
          href={`/desktop-demo?screen=estimate&ro=${roId}&vehicle=${vehicleId ?? "f150"}&title=${encodeURIComponent(newTitle ?? "")}`}
        >
          Estimate
        </a>
        <a href="#ro-checkout-workspace">Work</a>
        <span>Documents</span>
        <a href="#ro-checkout-workspace">Cashiering</a>
      </div>
      {showAdd && (
        <form id="new-demo-job" className={styles.addForm} onSubmit={addJob}>
          <div>
            <h3>
              {editId === null
                ? "Add work found during the visit"
                : "Edit unsent recommendation"}
            </h3>
            <p>
              Use this for requested service or a new inspection finding. Every
              new item starts pending authorization; it is not billable until
              approved and completed.
            </p>
          </div>
          <div
            className={styles.workTypeSelector}
            role="group"
            aria-label="Source of work"
          >
            <label>
              <input
                type="radio"
                checked={origin === "requested"}
                onChange={() => setOrigin("requested")}
              />{" "}
              Customer-requested work
            </label>
            <label>
              <input
                type="radio"
                checked={origin === "inspection"}
                onChange={() => setOrigin("inspection")}
              />{" "}
              Inspection recommendation
            </label>
          </div>
          <div className={styles.formFields}>
            <label>
              Job description
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="e.g. Replace rear brake pads"
                required
              />
            </label>
            <label>
              Customer price ($)
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                placeholder="0.00"
                required
              />
            </label>
            {internal && (
              <label>
                Internal cost ($){" "}
                <span className={styles.optional}>(optional)</span>
                <input
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  placeholder="0.00"
                />
              </label>
            )}
          </div>
          <label className={styles.workNotesLabel}>
            Advisor / technician findings (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="e.g. Brake pads measured at 2mm; technician recommended replacement"
            />
          </label>
          {error && (
            <p role="alert" className={styles.formError}>
              {error}
            </p>
          )}
          <div className={styles.formButtons}>
            <button type="submit" className={styles.addButton}>
              {editId === null ? "Add to RO as Pending" : "Save draft changes"}
            </button>
            <button type="button" onClick={closeEditor}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {deleteId !== null && (
        <div
          className={styles.removalPanel}
          role="group"
          aria-label="Delete unsent draft"
        >
          <div>
            <strong>Delete this unsent draft recommendation?</strong>
            <p>
              {jobs.find((job) => job.id === deleteId)?.name}. This is only
              allowed for newly added, pending demo work. Once presented to the
              customer, use a documented withdrawal or revised estimate.
            </p>
          </div>
          <div className={styles.formButtons}>
            <button
              type="button"
              className={styles.removeApprovalButton}
              onClick={deleteDraftJob}
            >
              Delete draft (demo)
            </button>
            <button type="button" onClick={() => setDeleteId(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {removalId !== null && (
        <div
          className={styles.removalPanel}
          role="group"
          aria-label="Remove approval"
        >
          <div>
            <strong>Remove this job from Approved Work?</strong>
            <p>
              {jobs.find((job) => job.id === removalId)?.name}
              {" — "}it will move to Not Approved and leave the billing
              subtotal.
            </p>
          </div>
          <label>
            Reason
            <select
              value={removalReason}
              onChange={(event) => setRemovalReason(event.target.value)}
            >
              <option>Customer changed their mind</option>
              <option>Customer declined additional work</option>
              <option>Work not going ahead</option>
              <option>Added to approved work by mistake</option>
            </select>
          </label>
          <div className={styles.formButtons}>
            <button
              type="button"
              className={styles.removeApprovalButton}
              onClick={removeApprovedJob}
            >
              Confirm removal (demo)
            </button>
            <button type="button" onClick={() => setRemovalId(null)}>
              Keep approved
            </button>
          </div>
        </div>
      )}
      {internal && <AdvisorCheckoutDemo roId={roId} jobs={jobs} />}
      <div className={styles.billingBanner}>
        <div>
          <span className={styles.eyebrow}>APPROVED WORK · BILLING BASIS</span>
          <strong>{money(approvedTotal)}</strong>
          <span>
            {approved.length} approved job{approved.length === 1 ? "" : "s"}
          </span>
        </div>
        <div>
          <span className={styles.eyebrow}>
            NOT APPROVED · EXCLUDED FROM BILLING
          </span>
          <strong>{money(suggestedTotal)}</strong>
          <span>{recommendations.length} pending or declined</span>
        </div>
      </div>
      <div className={styles.roSplit}>
        <section className={styles.panel} aria-label="Approved work">
          <div className={styles.panelHeader}>
            <div>
              <h2>Approved Work</h2>
              <p>
                Only authorized jobs belong in the work queue and eventual
                invoice.
              </p>
            </div>
            <span className={styles.approvedTag}>
              Approved · {approved.length}
            </span>
          </div>
          {jobTable(approved, false)}
          <div className={styles.sectionTotal}>
            <span>Authorized subtotal</span>
            <strong>{money(approvedTotal)}</strong>
          </div>
          {internal && (
            <div className={styles.internalDetails}>
              <div>
                Internal costs:{" "}
                <strong>
                  {costKnown ? money(approvedCosts) : "Incomplete"}
                </strong>
              </div>
              <div>
                Gross profit:{" "}
                <strong>
                  {costKnown ? money(approvedTotal - approvedCosts) : "Unknown"}
                </strong>
              </div>
            </div>
          )}
        </section>
        <section
          className={styles.panel}
          aria-label="Recommendations not approved"
        >
          <div className={styles.panelHeader}>
            <div>
              <h2>Recommendations / Not Approved</h2>
              <p>
                Pending and declined recommendations stay visible, but are
                excluded from the bill.
              </p>
            </div>
            <span className={styles.pendingTag}>
              {recommendations.length} excluded
            </span>
          </div>
          {jobTable(recommendations, true)}
          <div className={styles.sectionTotal}>
            <span>Not authorized — not billable</span>
            <strong>{money(suggestedTotal)}</strong>
          </div>
        </section>
      </div>
      {internal && <ShareMediaDemo key={roId} roId={roId} />}
      <div className={styles.note}>
        Demo only. Approval and removal buttons simulate decisions for layout
        review; they do not capture a signature, send email, alter a live RO, or
        generate an invoice. A finalized invoice would include only approved
        work actually performed, plus applicable taxes and fees.
      </div>
    </>
  );
}
