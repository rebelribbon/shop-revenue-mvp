"use client";

import { useState } from "react";
import styles from "./desktop-demo.module.css";

export type CustomerLine = {
  id: number;
  name: string;
  price: number;
  decision: "approved" | "pending" | "declined";
  origin?: "requested" | "inspection";
};
export type CustomerMedia = {
  id: string;
  label: string;
  description: string;
  kind: "photo" | "video";
  approved: boolean;
  jobId: number;
};
type Stage = "visit" | "inspection" | "decide" | "summary";
type Choice = "approved" | "declined";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);

const requestedIds: Record<string, number[]> = {
  "RO-10482": [1, 3],
  "RO-10193": [1],
  "RO-09914": [1, 2],
};
const inspectionFindings: Record<
  string,
  { passed: string[]; checked: string[] }
> = {
  "RO-10482": {
    passed: ["Exterior lighting", "Tire condition", "Windshield wipers"],
    checked: ["Brake system", "Brake fluid", "Cabin air filter"],
  },
  "RO-10193": {
    passed: ["Brake system", "Exterior lighting", "Battery test"],
    checked: ["Engine air filter", "Tire wear and pressure"],
  },
  "RO-09914": {
    passed: ["Tires", "Exterior lighting", "Fluid levels"],
    checked: ["Battery and charging system", "Battery terminals"],
  },
};

export function CustomerMobileFlow({
  roId,
  title,
  vehicle,
  jobs,
  media,
  onSubmit,
}: {
  roId: string;
  title: string;
  vehicle: string;
  jobs: CustomerLine[];
  media: CustomerMedia[];
  onSubmit: (
    choices: Record<number, Choice>,
    questionNotes: Record<number, string>,
  ) => void;
}) {
  const [stage, setStage] = useState<Stage>("visit");
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [evidenceId, setEvidenceId] = useState<number | null>(null);
  const [questionId, setQuestionId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Record<number, string>>({});
  const [draftQuestion, setDraftQuestion] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [signer, setSigner] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // Work ordered by the customer is not an inspection recommendation.
  const requested = jobs.filter(
    (j) =>
      j.origin === "requested" ||
      (!j.origin && (requestedIds[roId] ?? []).includes(j.id)),
  );
  const recommendations = jobs.filter((j) => !requested.includes(j));
  const findings = inspectionFindings[roId] ?? {
    passed: ["Lights and electrical", "Fluids"],
    checked: ["Technician recommendations"],
  };
  const baseTotal = requested.reduce((sum, j) => sum + j.price, 0);
  const additional = recommendations.reduce(
    (sum, j) => sum + (choices[j.id] === "approved" ? j.price : 0),
    0,
  );
  const decided = recommendations.filter(
    (j) => choices[j.id] !== undefined,
  ).length;
  const complete = decided === recommendations.length;
  const steps: { value: Stage; label: string }[] = [
    { value: "visit", label: "Your visit" },
    { value: "inspection", label: "Inspection" },
    { value: "decide", label: "Your choices" },
    { value: "summary", label: "Summary" },
  ];
  const stepIndex = steps.findIndex((s) => s.value === stage);
  function go(next: Stage) {
    setStage(next);
    // Keep the mobile flow at the heading of each new screen.
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function ask(id: number) {
    setEvidenceId(null);
    setQuestionId(id);
    setDraftQuestion(questions[id] ?? "");
  }
  function saveQuestion() {
    if (questionId !== null && draftQuestion.trim()) {
      setQuestions((current) => ({
        ...current,
        [questionId]: draftQuestion.trim(),
      }));
      setQuestionId(null);
      setDraftQuestion("");
    }
  }
  function submit() {
    if (!complete || !recommendations.length) return;
    go("summary");
  }
  function confirmSelections() {
    if (!signer.trim() || !confirmed || !complete || accepted) return;
    onSubmit(choices, questions);
    setAccepted(true);
  }
  return (
    <main id="main-content" className={styles.mobileCustomer}>
      <header className={styles.mobileCustomerHeader}>
        <div className={styles.mobileShopBrand}>
          ◆ SHOP REVENUE <span>DEMO</span>
        </div>
        <span className={styles.mobileSecureText}>Your vehicle update</span>
      </header>
      <div className={styles.mobileCustomerContent}>
        <div className={styles.mobileVisitHero}>
          <span className={styles.eyebrow}>JOHN SMITH · {roId}</span>
          <h1>{vehicle}</h1>
          <p>{title} · Inspection & service update</p>
        </div>
        <div className={styles.mobileStepDots} aria-label="Review steps">
          {steps.map((s, i) => (
            <div
              key={s.value}
              className={i <= stepIndex ? styles.mobileStepActive : ""}
            >
              <span>{i < stepIndex ? "✓" : i + 1}</span>
              <small>{s.label}</small>
            </div>
          ))}
        </div>

        {stage === "visit" && (
          <section
            className={styles.mobileSection}
            aria-labelledby="visit-title"
          >
            <div className={styles.mobileSectionNumber}>STEP 1 OF 4</div>
            <h2 id="visit-title">What you came in for</h2>
            <p className={styles.mobileIntro}>
              Here are the original services for your visit, before any
              additional recommendations from our inspection.
            </p>
            {requested.length ? (
              requested.map((j) => (
                <div key={j.id} className={styles.mobileServiceRow}>
                  <div>
                    <strong>{j.name}</strong>
                    <span>Original requested service</span>
                  </div>
                  <strong>{money(j.price)}</strong>
                </div>
              ))
            ) : (
              <p className={styles.mobileIntro}>
                No requested services have been entered yet.
              </p>
            )}
            <div className={styles.mobileEstimateTotal}>
              <span>Original service subtotal</span>
              <strong>{money(baseTotal)}</strong>
            </div>
            <div className={styles.mobileNextPrompt}>
              Your technician also performed an inspection. Review what was
              found before making any decisions.
            </div>
            <button
              type="button"
              className={styles.mobilePrimaryButton}
              onClick={() => go("inspection")}
            >
              View inspection findings <span aria-hidden="true">→</span>
            </button>
          </section>
        )}

        {stage === "inspection" && (
          <section
            className={styles.mobileSection}
            aria-labelledby="inspection-title"
          >
            <div className={styles.mobileSectionNumber}>STEP 2 OF 4</div>
            <h2 id="inspection-title">Your multi-point inspection</h2>
            <p className={styles.mobileIntro}>
              Our technician inspected your vehicle and identified the following
              areas. The recommendations are shown next, with evidence where
              your advisor has released it.
            </p>
            <div className={styles.mobileInspectionCard}>
              <div className={styles.mobileFindingHeading}>
                <span className={styles.mobilePassDot}>✓</span>
                <strong>Checked — no concerns</strong>
              </div>
              {findings.passed.map((f) => (
                <div className={styles.mobileFindingRow} key={f}>
                  <span>✓</span>
                  {f}
                </div>
              ))}
            </div>
            <div className={styles.mobileInspectionCard}>
              <div className={styles.mobileFindingHeading}>
                <span className={styles.mobileAttentionDot}>!</span>
                <strong>Attention recommended</strong>
              </div>
              {findings.checked.map((f) => (
                <div className={styles.mobileFindingRow} key={f}>
                  <span>!</span>
                  {f}
                </div>
              ))}
            </div>
            <div className={styles.mobileNextPrompt}>
              {recommendations.length} service recommendation
              {recommendations.length === 1 ? "" : "s"} to review. These are not
              automatically approved.
            </div>
            <button
              type="button"
              className={styles.mobilePrimaryButton}
              onClick={() => go("decide")}
            >
              Review recommendations <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className={styles.mobileTextButton}
              onClick={() => go("visit")}
            >
              ← Back to original services
            </button>
          </section>
        )}

        {stage === "decide" && (
          <section
            className={styles.mobileSection}
            aria-labelledby="recommendation-title"
          >
            <div className={styles.mobileSectionNumber}>STEP 3 OF 4</div>
            <h2 id="recommendation-title">Recommended services</h2>
            <p className={styles.mobileIntro}>
              Choose Approve or Decline for every recommendation. You can check
              evidence or ask a question before deciding.
            </p>
            <div className={styles.mobileProgressLine}>
              {decided} of {recommendations.length} decisions made
              <div className={styles.mobileProgressTrack}>
                <span
                  style={{
                    width: recommendations.length
                      ? `${(100 * decided) / recommendations.length}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
            {recommendations.map((j) => {
              const evidence = media.filter(
                (m) => m.jobId === j.id && m.approved,
              );
              const isOpen = evidenceId === j.id;
              return (
                <article className={styles.mobileRecommendation} key={j.id}>
                  <div className={styles.mobileRecTop}>
                    <div>
                      <span className={styles.mobileRecLabel}>
                        INSPECTION RECOMMENDATION
                      </span>
                      <h3>{j.name}</h3>
                    </div>
                    <strong>{money(j.price)}</strong>
                  </div>
                  <p className={styles.mobileRecDescription}>
                    Your technician recommended this service based on the
                    multi-point inspection.
                  </p>
                  <div className={styles.mobileEvidenceActions}>
                    <button
                      type="button"
                      onClick={() => {
                        setEvidenceId(isOpen ? null : j.id);
                        setQuestionId(null);
                      }}
                      aria-expanded={isOpen}
                    >
                      ▣ View photos / videos{" "}
                      {evidence.length ? `(${evidence.length})` : ""}
                    </button>
                    <button type="button" onClick={() => ask(j.id)}>
                      Ask a question
                    </button>
                  </div>
                  {isOpen && (
                    <div className={styles.mobileEvidencePanel}>
                      {evidence.length ? (
                        evidence.map((m) => (
                          <div className={styles.mobileEvidenceTile} key={m.id}>
                            <div
                              className={styles.mobileMediaPlaceholder}
                              aria-label="Demo media placeholder"
                            >
                              <span>{m.kind === "photo" ? "▧" : "▶"}</span>
                              <small>{m.kind.toUpperCase()} PLACEHOLDER</small>
                            </div>
                            <div>
                              <strong>{m.label}</strong>
                              <p>{m.description}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p>
                          No photos or videos have been approved for sharing on
                          this recommendation. You can ask your advisor for
                          evidence.
                        </p>
                      )}
                    </div>
                  )}
                  {questions[j.id] && (
                    <p className={styles.mobileQuestionSaved}>
                      Question noted in this demo: {questions[j.id]}
                    </p>
                  )}
                  <div
                    className={styles.mobileDecisions}
                    role="group"
                    aria-label={`Decision for ${j.name}`}
                  >
                    <button
                      type="button"
                      disabled={accepted}
                      aria-pressed={choices[j.id] === "approved"}
                      onClick={() =>
                        setChoices((x) => ({ ...x, [j.id]: "approved" }))
                      }
                      className={
                        choices[j.id] === "approved"
                          ? styles.mobileApproveSelected
                          : ""
                      }
                    >
                      ✓ Approve
                    </button>
                    <button
                      type="button"
                      disabled={accepted}
                      aria-pressed={choices[j.id] === "declined"}
                      onClick={() =>
                        setChoices((x) => ({ ...x, [j.id]: "declined" }))
                      }
                      className={
                        choices[j.id] === "declined"
                          ? styles.mobileDeclineSelected
                          : ""
                      }
                    >
                      ✕ Decline
                    </button>
                  </div>
                </article>
              );
            })}
            {!recommendations.length && (
              <p className={styles.mobileIntro}>
                The inspection has no additional recommendations for this visit.
              </p>
            )}
            <div className={styles.mobileEstimateTotal}>
              <span>Additional work selected</span>
              <strong>{money(additional)}</strong>
            </div>
            <button
              type="button"
              className={styles.mobilePrimaryButton}
              disabled={!complete || !recommendations.length}
              onClick={submit}
            >
              Review my choices <span aria-hidden="true">→</span>
            </button>
            {!complete && (
              <p className={styles.mobileMustDecide}>
                Choose Approve or Decline on every recommendation to continue.
              </p>
            )}
            <button
              type="button"
              className={styles.mobileTextButton}
              onClick={() => go("inspection")}
            >
              ← Back to inspection findings
            </button>
          </section>
        )}

        {stage === "summary" && (
          <section
            className={styles.mobileSection}
            aria-labelledby="summary-title"
          >
            <div className={styles.mobileSectionNumber}>STEP 4 OF 4</div>
            <h2 id="summary-title">Your service summary</h2>
            <p className={styles.mobileIntro}>
              {accepted
                ? "Your demo selections have been recorded in this browser."
                : "Here is what has already been approved and what is still pending on your visit."}
            </p>
            <div className={styles.mobileInspectionCard}>
              <h3>Originally requested work</h3>
              {requested.map((j) => (
                <div key={j.id} className={styles.mobileSummaryRow}>
                  <span>{j.name}</span>
                  <strong>{money(j.price)}</strong>
                </div>
              ))}
              <div className={styles.mobileSummaryRow}>
                <strong>Original subtotal</strong>
                <strong>{money(baseTotal)}</strong>
              </div>
            </div>
            <div className={styles.mobileInspectionCard}>
              <h3>Additional authorized work</h3>
              {recommendations
                .filter((j) => choices[j.id] === "approved")
                .map((j) => (
                  <div key={j.id} className={styles.mobileSummaryRow}>
                    <span>{j.name}</span>
                    <strong>{money(j.price)}</strong>
                  </div>
                ))}
              {!recommendations.some((j) => choices[j.id] === "approved") && (
                <p>No additional work approved.</p>
              )}
              <div className={styles.mobileSummaryRow}>
                <strong>Added work subtotal</strong>
                <strong>{money(additional)}</strong>
              </div>
            </div>
            <div className={styles.mobileGrandTotal}>
              <span>Authorized services (before tax/fees)</span>
              <strong>{money(baseTotal + additional)}</strong>
            </div>
            <div className={styles.mobileInvoiceNotice}>
              <strong>What happens next?</strong>
              <p>
                Approved recommendations become work for the technician on this
                same RO. They are added to the final invoice only after they are
                completed. Declined recommendations stay in the service history
                and are not billed.
              </p>
            </div>
            {!accepted ? (
              <div className={styles.mobileConfirmation}>
                <h3>Confirm your decisions</h3>
                <p>
                  Your selections are ready for authorization. In the working
                  CRM, this step will use the secure, versioned electronic
                  signature flow.
                </p>
                <label htmlFor="demo-customer-name">Customer name</label>
                <input
                  id="demo-customer-name"
                  value={signer}
                  onChange={(e) => setSigner(e.target.value)}
                  maxLength={100}
                  placeholder="Enter your name"
                  autoComplete="name"
                />
                <label className={styles.mobileConfirmCheck}>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  I understand the approved recommendations will be added to the
                  shop’s work queue.
                </label>
                <button
                  type="button"
                  className={styles.mobilePrimaryButton}
                  disabled={!confirmed || !signer.trim()}
                  onClick={confirmSelections}
                >
                  Confirm selections (demo)
                </button>
              </div>
            ) : (
              <div className={styles.mobileSuccessMessage} role="status">
                ✓ Demo selections recorded. Approved recommendations have moved
                to this RO’s work list.
              </div>
            )}

            <p className={styles.estimateDisclaimer}>
              Simulation only. This is not an electronic signature or legally
              binding authorization. A real customer must sign a frozen estimate
              before work can proceed.
            </p>
            {!accepted && (
              <button
                type="button"
                className={styles.mobileTextButton}
                onClick={() => go("decide")}
              >
                ← Change my choices
              </button>
            )}
          </section>
        )}
      </div>
      {questionId !== null && (
        <div
          className={styles.mobileQuestionOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Question for service advisor"
        >
          <div className={styles.mobileQuestionSheet}>
            <h2>Question about this recommendation</h2>
            <p>{recommendations.find((j) => j.id === questionId)?.name}</p>
            <label htmlFor="customer-demo-question">
              What would you like to ask your service advisor?
            </label>
            <textarea
              id="customer-demo-question"
              value={draftQuestion}
              onChange={(e) => setDraftQuestion(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="Can you show me why this needs replacing?"
            />
            <p className={styles.estimateDisclaimer}>
              Demo only: your question stays in this browser. No message is
              sent.
            </p>
            <div className={styles.mobileQuestionButtons}>
              <button
                type="button"
                className={styles.mobilePrimaryButton}
                disabled={!draftQuestion.trim()}
                onClick={saveQuestion}
              >
                Save question (demo)
              </button>
              <button
                type="button"
                className={styles.mobileTextButton}
                onClick={() => setQuestionId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
