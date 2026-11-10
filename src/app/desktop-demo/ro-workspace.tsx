"use client";

import { useState } from "react";
import styles from "./desktop-demo.module.css";

type Decision = "approved" | "pending" | "declined";
type DemoJob = { id: number; name: string; price: number; cost: number | null; decision: Decision };
const initialJobs: DemoJob[] = [
  { id: 1, name: "Front brake pads and rotors", price: 425, cost: 175, decision: "approved" },
  { id: 2, name: "Brake fluid flush", price: 180, cost: 55, decision: "pending" },
  { id: 3, name: "Multi-point inspection", price: 80, cost: 20, decision: "approved" },
  { id: 4, name: "Cabin air filter replacement", price: 65, cost: 18, decision: "declined" },
];
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export function RoWorkspace({ internal }: { internal: boolean }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState("");
  const [nextId, setNextId] = useState(5);
  const approved = jobs.filter((job) => job.decision === "approved");
  const recommendations = jobs.filter((job) => job.decision !== "approved");
  const approvedTotal = approved.reduce((sum, job) => sum + job.price, 0);
  const suggestedTotal = recommendations.reduce((sum, job) => sum + job.price, 0);
  const costKnown = approved.every((job) => job.cost !== null);
  const approvedCosts = approved.reduce((sum, job) => sum + (job.cost ?? 0), 0);
  function setDecision(id: number, decision: Decision) {
    setJobs((old) => old.map((job) => job.id === id ? { ...job, decision } : job));
  }
  function addJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(price);
    const internalCost = cost.trim() === "" ? null : Number(cost);
    if (!name.trim() || !Number.isFinite(amount) || amount < 0 || !/^(?:\d+)(?:\.\d{1,2})?$/.test(price) ||
        (cost.trim() !== "" && (!Number.isFinite(internalCost) || internalCost === null || internalCost < 0 || !/^(?:\d+)(?:\.\d{1,2})?$/.test(cost)))) {
      setError("Enter a job description and a valid customer price (up to two decimals).");
      return;
    }
    setJobs((old) => [...old, { id: nextId, name: name.trim(), price: amount, cost: internalCost, decision: "pending" }]);
    setNextId((id) => id + 1);
    setName("");
    setPrice("");
    setCost("");
    setError("");
    setShowAdd(false);
  }
  function jobTable(items: DemoJob[], proposed: boolean) {
    return (
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr><th>Job / Service</th><th>Customer price</th><th>Status</th>
              {internal && <><th>Internal cost</th><th>Gross profit</th></>}
              {proposed && <th>Demo decision</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((job) => (
              <tr key={job.id}>
                <td><strong>{job.name}</strong></td>
                <td>{money(job.price)}</td>
                <td><span className={job.decision === "approved" ? styles.approvedTag : job.decision === "declined" ? styles.declinedTag : styles.pendingTag}>{job.decision === "approved" ? "Approved" : job.decision === "declined" ? "Declined" : "Awaiting approval"}</span></td>
                {internal && <><td>{job.cost === null ? "Unknown" : money(job.cost)}</td><td>{job.cost === null ? "Unknown" : money(job.price - job.cost)}</td></>}
                {proposed && <td>
                  <div className={styles.rowActions}>
                    <button type="button" onClick={() => setDecision(job.id, "approved")}>Approve (demo)</button>
                    {job.decision !== "declined" && <button type="button" onClick={() => setDecision(job.id, "declined")}>Decline (demo)</button>}
                  </div>
                </td>}
              </tr>
            ))}
            {!items.length && <tr><td colSpan={internal ? (proposed ? 6 : 5) : (proposed ? 4 : 3)} className={styles.emptyState}>{proposed ? "No unapproved recommendations." : "No work has been approved yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <>
      <div className={styles.roHead}>
        <div><div className={styles.eyebrow}>REPAIR ORDER · RO-10482</div><h2>Brake Service</h2><p>2021 Ford F-150 · VIN ending 4821</p></div>
        <div className={styles.roActions}><span className={styles.pill}>In progress</span><button type="button" className={styles.addButton} onClick={() => setShowAdd((value) => !value)} aria-expanded={showAdd} aria-controls="new-demo-job">+ Add Job</button></div>
      </div>
      <div className={styles.tabs}><strong>Overview</strong><span>Estimate</span><span>Work</span><span>Documents</span><span>Cashiering</span></div>
      {showAdd && (
        <form id="new-demo-job" className={styles.addForm} onSubmit={addJob}>
          <div><h3>Add recommended job</h3><p>New work starts awaiting customer approval. Nothing is billable until authorized.</p></div>
          <div className={styles.formFields}>
            <label>Job description<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Replace rear brake pads" required /></label>
            <label>Customer price ($)<input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" max="1000000" step="0.01" placeholder="0.00" required /></label>
            {internal && <label>Internal cost ($) <span className={styles.optional}>(optional)</span><input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min="0" max="1000000" step="0.01" placeholder="0.00" /></label>}
          </div>
          {error && <p role="alert" className={styles.formError}>{error}</p>}
          <div className={styles.formButtons}><button type="submit" className={styles.addButton}>Add to recommendations</button><button type="button" onClick={() => {setShowAdd(false);setError("");}}>Cancel</button></div>
        </form>
      )}
      <div className={styles.billingBanner}>
        <div><span className={styles.eyebrow}>APPROVED WORK · BILLING BASIS</span><strong>{money(approvedTotal)}</strong><span>{approved.length} approved job{approved.length === 1 ? "" : "s"}</span></div>
        <div><span className={styles.eyebrow}>NOT APPROVED · EXCLUDED FROM BILLING</span><strong>{money(suggestedTotal)}</strong><span>{recommendations.length} pending or declined</span></div>
      </div>
      <div className={styles.roSplit}>
        <section className={styles.panel} aria-label="Approved work">
          <div className={styles.panelHeader}><div><h2>Approved Work</h2><p>Only authorized jobs belong in the work queue and eventual invoice.</p></div><span className={styles.approvedTag}>Approved · {approved.length}</span></div>
          {jobTable(approved, false)}
          <div className={styles.sectionTotal}><span>Authorized subtotal</span><strong>{money(approvedTotal)}</strong></div>
          {internal && <div className={styles.internalDetails}><div>Internal costs: <strong>{costKnown ? money(approvedCosts) : "Incomplete"}</strong></div><div>Gross profit: <strong>{costKnown ? money(approvedTotal - approvedCosts) : "Unknown"}</strong></div></div>}
        </section>
        <section className={styles.panel} aria-label="Recommendations not approved">
          <div className={styles.panelHeader}><div><h2>Recommendations / Not Approved</h2><p>Pending and declined recommendations stay visible, but are excluded from the bill.</p></div><span className={styles.pendingTag}>{recommendations.length} excluded</span></div>
          {jobTable(recommendations, true)}
          <div className={styles.sectionTotal}><span>Not authorized — not billable</span><strong>{money(suggestedTotal)}</strong></div>
        </section>
      </div>
      <div className={styles.note}>Demo only. Approval buttons simulate a decision for layout review; they do not capture a signature, send email, alter a live RO, or generate an invoice. A finalized invoice would include only approved work actually performed, plus applicable taxes and fees.</div>
    </>
  );
}
