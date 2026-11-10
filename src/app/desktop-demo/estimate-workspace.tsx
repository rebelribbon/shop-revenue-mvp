"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./desktop-demo.module.css";
import { roRecords, type DemoJob } from "./ro-workspace";

type Choice = "approve" | "decline" | null;
type EstimateStep = "edit" | "customer" | "review";
type EstimateRecord = {
  version: number;
  choices: Record<string, Choice>;
  sent: boolean;
  authorized: boolean;
  signer: string;
  signedAt?: string;
  history?: Array<{
    version: number;
    choices: Record<string, Choice>;
    signer: string;
    signedAt: string;
  }>;
};
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );

export function EstimateWorkspace({
  roId,
  vehicleId,
  newTitle,
}: {
  roId: string;
  vehicleId: string;
  newTitle: string;
}) {
  const existing = roRecords[roId as keyof typeof roRecords];
  const name = existing?.title ?? newTitle ?? "New repair order";
  const vehicle =
    existing?.vehicle ??
    (vehicleId === "accord"
      ? "2018 Honda Accord · VIN ending 9134"
      : "2021 Ford F-150 · VIN ending 4821");
  const roKey = `shop-revenue-desktop-demo-ro-v2:${roId}`;
  const estimateKey = `shop-revenue-desktop-demo-estimate-v1:${roId}`;
  const [jobs, setJobs] = useState<DemoJob[]>(() => [
    ...(existing?.jobs ?? []),
  ]);
  const [record, setRecord] = useState<EstimateRecord>({
    version: 1,
    choices: {},
    sent: false,
    authorized: false,
    signer: "",
  });
  const [step, setStep] = useState<EstimateStep>("edit");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    let storedJobs: DemoJob[] | null = null;
    let storedEstimate: EstimateRecord | null = null;
    try {
      const saved = sessionStorage.getItem(roKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (x) =>
              x &&
              typeof x.id === "number" &&
              typeof x.name === "string" &&
              typeof x.price === "number" &&
              ["approved", "pending", "declined"].includes(x.decision),
          )
        )
          storedJobs = parsed as DemoJob[];
      }
      const savedEstimate = sessionStorage.getItem(estimateKey);
      if (savedEstimate) {
        const parsed: unknown = JSON.parse(savedEstimate);
        if (
          parsed &&
          typeof parsed === "object" &&
          "choices" in parsed &&
          "version" in parsed
        ) {
          storedEstimate = parsed as EstimateRecord;
        }
      }
    } catch {
      /* The demo remains usable without session persistence. */
    }
    queueMicrotask(() => {
      if (!live) return;
      if (storedJobs) setJobs(storedJobs);
      if (storedEstimate) setRecord(storedEstimate);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [roKey, estimateKey]);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(estimateKey, JSON.stringify(record));
    } catch {
      /* Preview-only storage. */
    }
  }, [ready, estimateKey, record]);

  const choices = jobs.map((job) => record.choices[String(job.id)] ?? null);
  const decided = choices.filter(Boolean).length;
  const canAuthorize =
    jobs.length > 0 &&
    decided === jobs.length &&
    Boolean(record.signer.trim()) &&
    !record.authorized;
  const proposed = jobs.reduce((sum, j) => sum + j.price, 0);
  const chosen = jobs.reduce(
    (sum, j) =>
      sum + (record.choices[String(j.id)] === "approve" ? j.price : 0),
    0,
  );
  const declined = proposed - chosen;
  const roHref = `/desktop-demo?screen=ro&ro=${encodeURIComponent(roId)}&vehicle=${vehicleId}&title=${encodeURIComponent(newTitle)}`;

  function decide(id: number, choice: Exclude<Choice, null>) {
    if (record.authorized) return;
    setRecord((prev) => ({
      ...prev,
      choices: { ...prev.choices, [String(id)]: choice },
    }));
    setError("");
  }
  function simulateSend() {
    if (!jobs.length) {
      setError("Add at least one recommended job to the RO first.");
      return;
    }
    setRecord((prev) => ({ ...prev, sent: true }));
    setStep("customer");
    setError("");
  }
  function authorize() {
    if (!canAuthorize) {
      setError(
        "Each line needs an Approve or Decline selection and a signer name.",
      );
      return;
    }
    const confirmed: DemoJob[] = jobs.map((job) => ({
      ...job,
      decision:
        record.choices[String(job.id)] === "approve" ? "approved" : "declined",
    }));
    try {
      sessionStorage.setItem(roKey, JSON.stringify(confirmed));
    } catch {
      /* Data only changes in the current demo browser. */
    }
    setJobs(confirmed);
    setRecord((prev) => ({
      ...prev,
      authorized: true,
      signedAt: "Demo authorization recorded in this browser",
    }));
    setStep("review");
    setError("");
  }
  function revise() {
    setRecord((prev) => ({
      version: prev.version + 1,
      choices: {},
      sent: false,
      authorized: false,
      signer: "",
      history: [
        ...(prev.history ?? []),
        {
          version: prev.version,
          choices: { ...prev.choices },
          signer: prev.signer,
          signedAt: prev.signedAt ?? "Authorized in demo",
        },
      ],
    }));
    setStep("edit");
    setError("");
  }

  return (
    <div className={styles.estimateWorkspace}>
      <div className={styles.estimateHead}>
        <div>
          <div className={styles.eyebrow}>
            REPAIR ORDER {roId} · ESTIMATE V{record.version}
          </div>
          <h2>Estimate & Authorization</h2>
          <p>
            {name} · {vehicle}
          </p>
        </div>
        <div className={styles.estimateActions}>
          <Link className={styles.returnButton} href={roHref}>
            ← Back to RO
          </Link>
          <span
            className={
              record.authorized
                ? styles.approvedTag
                : record.sent
                  ? styles.pendingTag
                  : styles.pill
            }
          >
            {record.authorized
              ? "Demo authorized"
              : record.sent
                ? "Awaiting customer decision"
                : "Draft"}
          </span>
        </div>
      </div>
      <nav className={styles.estimateNav} aria-label="Estimate workflow">
        <button
          type="button"
          className={step === "edit" ? styles.estimateNavSelected : ""}
          onClick={() => setStep("edit")}
        >
          1. Prepare estimate
        </button>
        <button
          type="button"
          className={step === "customer" ? styles.estimateNavSelected : ""}
          onClick={() => setStep("customer")}
        >
          2. Customer view
        </button>
        <button
          type="button"
          className={step === "review" ? styles.estimateNavSelected : ""}
          onClick={() => setStep("review")}
        >
          3. Authorization history
        </button>
      </nav>
      {step === "edit" && (
        <div className={styles.estimateColumns}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Work proposed on this RO</h2>
                <p>
                  Build the proposal using jobs already on {roId}. Nothing is
                  automatically authorized.
                </p>
              </div>
              <span className={styles.pill}>{jobs.length} lines</span>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Customer price</th>
                    <th>Authorization</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <strong>{j.name}</strong>
                      </td>
                      <td>{money(j.price)}</td>
                      <td>
                        {record.authorized
                          ? "Confirmed in demo"
                          : "Customer must choose"}
                      </td>
                    </tr>
                  ))}
                  {!jobs.length && (
                    <tr>
                      <td colSpan={3}>
                        No jobs yet. Return to the RO and use + Add Job.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className={styles.sectionTotal}>
              <span>Estimate subtotal before applicable taxes and fees</span>
              <strong>{money(proposed)}</strong>
            </div>
            <div className={styles.estimateFooter}>
              <Link className={styles.returnButton} href={roHref}>
                Edit jobs on RO
              </Link>
              <button
                type="button"
                className={styles.addButton}
                disabled={!jobs.length}
                onClick={simulateSend}
              >
                Simulate sending to customer →
              </button>
            </div>
          </section>
          <aside className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>How this flows</h2>
            </div>
            <div className={styles.estimateGuide}>
              <p>
                <strong>1.</strong> Create the jobs on the RO.
              </p>
              <p>
                <strong>2.</strong> Preview the customer estimate (prices only).
              </p>
              <p>
                <strong>3.</strong> Customer explicitly decides every line and
                signs.
              </p>
              <p>
                <strong>4.</strong> Approved lines return to the RO work queue;
                declined lines stay as recommendations.
              </p>
              <p>
                <strong>5.</strong> Invoice only work actually performed and
                authorized.
              </p>
            </div>
          </aside>
        </div>
      )}
      {step === "customer" && (
        <section className={styles.estimateDocument}>
          <div className={styles.estimatePaperHead}>
            <strong>
              SHOP REVENUE <small>DEMO</small>
            </strong>
            <span>
              Estimate #{roId} · Version {record.version}
            </span>
          </div>
          <h2>Service estimate</h2>
          <div className={styles.estimateCustomer}>
            <div>
              <strong>Prepared for</strong>
              <p>John Smith</p>
              <p>john@example.com</p>
            </div>
            <div>
              <strong>Vehicle</strong>
              <p>{vehicle}</p>
              <p>{roId}</p>
            </div>
          </div>
          <p className={styles.estimateInstruction}>
            Review every recommended service. Select <strong>Approve</strong> or{" "}
            <strong>Decline</strong> for each one before submitting. No option
            is preselected.
          </p>
          {jobs.map((j) => (
            <div className={styles.estimateItem} key={j.id}>
              <div>
                <strong>{j.name}</strong>
                <span>Customer price: {money(j.price)}</span>
              </div>
              <div
                className={styles.estimateChoice}
                role="group"
                aria-label={`Decision for ${j.name}`}
              >
                <button
                  type="button"
                  disabled={record.authorized}
                  aria-pressed={record.choices[String(j.id)] === "approve"}
                  className={
                    record.choices[String(j.id)] === "approve"
                      ? styles.estimateChooseYes
                      : ""
                  }
                  onClick={() => decide(j.id, "approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={record.authorized}
                  aria-pressed={record.choices[String(j.id)] === "decline"}
                  className={
                    record.choices[String(j.id)] === "decline"
                      ? styles.estimateChooseNo
                      : ""
                  }
                  onClick={() => decide(j.id, "decline")}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
          <div className={styles.estimateTotals}>
            <span>Approved selections (before applicable taxes/fees)</span>
            <strong>{money(chosen)}</strong>
          </div>
          <p className={styles.estimateProgress}>
            {decided} of {jobs.length} lines decided.{" "}
            {jobs.length > 0 && decided < jobs.length
              ? "Finish every line to proceed."
              : ""}
          </p>
          <label className={styles.estimateSigner}>
            Customer signature name — demo only
            <input
              value={record.signer}
              maxLength={100}
              onChange={(e) =>
                setRecord((prev) => ({ ...prev, signer: e.target.value }))
              }
              placeholder="Enter customer name"
              disabled={record.authorized}
            />
          </label>
          <p className={styles.estimateDisclaimer}>
            This is an interactive simulation, not an actual electronic
            signature or legally binding authorization. No email is sent and no
            payment is taken.
          </p>
          {error && (
            <p role="alert" className={styles.formError}>
              {error}
            </p>
          )}
          <div className={styles.estimateFooter}>
            <button
              type="button"
              className={styles.addButton}
              disabled={!canAuthorize}
              onClick={authorize}
            >
              Record demo selections
            </button>
            <button
              type="button"
              className={styles.returnButton}
              onClick={() => setStep("edit")}
            >
              Back to draft
            </button>
          </div>
        </section>
      )}
      {step === "review" && (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Authorization & estimate history</h2>
              <p>
                Estimate version {record.version} for {roId}. Previous signed
                versions would remain immutable in the real CRM.
              </p>
            </div>
            <span
              className={
                record.authorized ? styles.approvedTag : styles.pendingTag
              }
            >
              {record.authorized ? "Demo authorization recorded" : "Not signed"}
            </span>
          </div>
          <div className={styles.estimateSummary}>
            <div>
              <span>Proposed</span>
              <strong>{money(proposed)}</strong>
            </div>
            <div>
              <span>Approved</span>
              <strong>{money(chosen)}</strong>
            </div>
            <div>
              <span>Not approved</span>
              <strong>{money(declined)}</strong>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Decision on this version</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.name}</td>
                    <td>{record.choices[String(j.id)] ?? "Undecided"}</td>
                    <td>{money(j.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Boolean(record.history?.length) && (
            <div className={styles.estimateGuide}>
              <h3>Previous authorizations (demo snapshots)</h3>
              {record.history?.map((v) => (
                <p key={v.version}>
                  <strong>Version {v.version}</strong> · {v.signer} ·{" "}
                  {v.signedAt} ·{" "}
                  {
                    Object.values(v.choices).filter((x) => x === "approve")
                      .length
                  }{" "}
                  approved lines
                </p>
              ))}
            </div>
          )}
          <div className={styles.estimateFooter}>
            <Link href={roHref} className={styles.returnButton}>
              ← Return to RO
            </Link>
            {record.authorized && (
              <button
                type="button"
                onClick={revise}
                className={styles.addButton}
              >
                Start new estimate version (demo)
              </button>
            )}
          </div>
        </section>
      )}
      <div className={styles.note}>
        Estimate belongs to {roId}, not a separate RO. Demo actions stay in this
        browser only. Production must freeze every signed version, authenticate
        the signer, record an audit trail, and require a new authorization when
        work changes.
      </div>
    </div>
  );
}
