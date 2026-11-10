"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDemoCheckout } from "./ro-checkout-demo";
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
  const { state: checkoutState, loaded: checkoutLoaded } =
    useDemoCheckout(roId);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [accepted, setAccepted] = useState(false);
  const [loadedChoices, setLoadedChoices] = useState(false);
  const [evidenceId, setEvidenceId] = useState<number | null>(null);
  const [questionId, setQuestionId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Record<number, string>>({});
  const [draftQuestion, setDraftQuestion] = useState("");
  const [signer, setSigner] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);
  const requested = jobs.filter(
    (j) =>
      j.origin === "requested" ||
      (!j.origin && (requestedIds[roId] ?? []).includes(j.id)),
  );
  const recommendations = jobs.filter(
    (j) => !requested.some((base) => base.id === j.id),
  );
  const inspection = inspectionFindings[roId] ?? { passed: [], checked: [] };
  const baseTotal = requested.reduce((sum, j) => sum + j.price, 0);
  const selectedTotal = recommendations.reduce(
    (sum, j) => sum + (choices[j.id] === "approved" ? j.price : 0),
    0,
  );
  const decisionsMade = recommendations.filter((j) => choices[j.id]).length;
  const allDecided = decisionsMade === recommendations.length;
  const locked = accepted || checkoutState.phase !== "working";
  const phase = checkoutState.phase;
  const ready = ["invoice_ready", "paid", "delivered"].includes(phase);
  const statusLabel =
    phase === "working"
      ? "In service"
      : phase === "qc"
        ? "Final quality check"
        : phase === "invoice_draft"
          ? "Preparing invoice"
          : phase === "invoice_ready"
            ? "Ready for checkout"
            : phase === "paid"
              ? "Paid · awaiting pickup"
              : "Delivered";
  const statusCopy =
    phase === "working"
      ? "Your technician is working on the authorized services."
      : phase === "qc"
        ? "The work is complete. The advisor is checking the vehicle."
        : phase === "invoice_draft"
          ? "The advisor is reviewing the final bill."
          : phase === "invoice_ready"
            ? "Your completed work is ready to review and pay."
            : phase === "paid"
              ? "Payment received. The vehicle is waiting for pickup."
              : "Your vehicle has been delivered and the RO is closed.";

  useEffect(() => {
    let alive = true;
    let previous: Record<number, Choice> | null = null;
    try {
      const saved = sessionStorage.getItem(
        `shop-revenue-desktop-demo-customer-choices-v1:${roId}`,
      );
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Object.values(parsed).every(
            (v) => v === "approved" || v === "declined",
          )
        ) {
          previous = parsed as Record<number, Choice>;
        }
      }
    } catch {
      /* No browser state is required for preview. */
    }
    queueMicrotask(() => {
      if (!alive) return;
      if (previous) {
        setChoices(previous);
        setAccepted(true);
      }
      setLoadedChoices(true);
    });
    return () => {
      alive = false;
    };
  }, [roId]);

  function review() {
    setReviewing(true);
    requestAnimationFrame(() =>
      reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  function saveQuestion() {
    if (questionId === null || !draftQuestion.trim()) return;
    setQuestions((current) => ({
      ...current,
      [questionId]: draftQuestion.trim(),
    }));
    setQuestionId(null);
    setDraftQuestion("");
  }
  function submitChoices() {
    if (locked || !allDecided || !signer.trim() || !confirmed || !loadedChoices)
      return;
    onSubmit(choices, questions);
    setAccepted(true);
    setReviewing(false);
  }

  return (
    <main id="main-content" className={styles.customerJourney}>
      <header className={styles.journeyHeader}>
        <strong>◆ SHOP REVENUE</strong>
        <span>Service update · Demo</span>
      </header>
      <div className={styles.journeyBody}>
        <div className={styles.journeyHero}>
          <span className={styles.journeyEyebrow}>JOHN SMITH · {roId}</span>
          <h1>{vehicle}</h1>
          <p>{title}</p>
          <div className={styles.journeyStatus}>
            <div>
              <span className={styles.journeyStatusDot} />
              <strong>{checkoutLoaded ? statusLabel : "Loading status"}</strong>
            </div>
            <p>
              {checkoutLoaded
                ? statusCopy
                : "Retrieving demo service progress."}
            </p>
            {ready && (
              <Link
                className={styles.journeyPayLink}
                href={`/desktop-demo?screen=checkout&ro=${encodeURIComponent(roId)}`}
              >
                Review invoice & payment →
              </Link>
            )}
          </div>
        </div>

        <section
          className={styles.journeyCard}
          aria-labelledby="journey-requested"
        >
          <div className={styles.journeySectionHead}>
            <span className={styles.journeyNumber}>1</span>
            <div>
              <h2 id="journey-requested">What you came in for</h2>
              <p>Original services, before inspection recommendations.</p>
            </div>
          </div>
          {requested.length ? (
            requested.map((j) => (
              <div key={j.id} className={styles.journeyPriceRow}>
                <span>{j.name}</span>
                <strong>{money(j.price)}</strong>
              </div>
            ))
          ) : (
            <p>No originally requested services have been entered.</p>
          )}
          <div className={styles.journeySubtotal}>
            <span>Original subtotal</span>
            <strong>{money(baseTotal)}</strong>
          </div>
        </section>

        <section
          className={styles.journeyCard}
          aria-labelledby="journey-inspection"
        >
          <div className={styles.journeySectionHead}>
            <span className={styles.journeyNumber}>2</span>
            <div>
              <h2 id="journey-inspection">Multi-point inspection</h2>
              <p>What the technician checked and found.</p>
            </div>
          </div>
          <div className={styles.journeyInspectionColumns}>
            <div className={styles.journeyInspectionGroup}>
              <h3>
                <span className={styles.journeyPassed}>✓</span> Checked — okay
              </h3>
              {inspection.passed.map((item) => (
                <p key={item}>
                  <span>✓</span>
                  {item}
                </p>
              ))}
              {!inspection.passed.length && (
                <p>No inspection items recorded.</p>
              )}
            </div>
            <div className={styles.journeyInspectionGroup}>
              <h3>
                <span className={styles.journeyNeeds}>!</span> Needs attention
              </h3>
              {inspection.checked.map((item) => (
                <p key={item}>
                  <span>!</span>
                  {item}
                </p>
              ))}
              {!inspection.checked.length && (
                <p>No additional findings recorded.</p>
              )}
            </div>
          </div>
          <p className={styles.journeyCallout}>
            The items below are recommendations, not charges. You decide whether
            to approve them.
          </p>
        </section>

        <section
          className={styles.journeyCard}
          aria-labelledby="journey-recommendations"
        >
          <div className={styles.journeySectionHead}>
            <span className={styles.journeyNumber}>3</span>
            <div>
              <h2 id="journey-recommendations">Your recommendations</h2>
              <p>
                See the price, review evidence, then approve or decline each
                item.
              </p>
            </div>
          </div>
          <div className={styles.journeyDecisionProgress}>
            <span>
              {accepted
                ? "Decisions recorded"
                : `${decisionsMade} of ${recommendations.length} reviewed`}
            </span>
            <div>
              <span
                style={{
                  width: `${recommendations.length ? (decisionsMade / recommendations.length) * 100 : 100}%`,
                }}
              />
            </div>
          </div>
          {recommendations.map((j) => {
            const visibleMedia = media.filter(
              (m) => m.approved && m.jobId === j.id,
            );
            return (
              <article className={styles.journeyRecommendation} key={j.id}>
                <div className={styles.journeyRecHeading}>
                  <h3>{j.name}</h3>
                  <strong>{money(j.price)}</strong>
                </div>
                <p>
                  Recommended based on the technician’s inspection. This service
                  is not included unless you approve it.
                </p>
                <div className={styles.journeyRecLinks}>
                  <button
                    type="button"
                    aria-expanded={evidenceId === j.id}
                    onClick={() =>
                      setEvidenceId(evidenceId === j.id ? null : j.id)
                    }
                  >
                    <span aria-hidden="true">▧</span> View evidence
                    {visibleMedia.length ? ` (${visibleMedia.length})` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestionId(j.id);
                      setDraftQuestion(questions[j.id] ?? "");
                    }}
                  >
                    Ask the advisor
                  </button>
                </div>
                {evidenceId === j.id && (
                  <div
                    className={styles.journeyEvidence}
                    role="region"
                    aria-label={`Evidence for ${j.name}`}
                  >
                    {visibleMedia.length ? (
                      visibleMedia.map((m) => (
                        <div className={styles.journeyMedia} key={m.id}>
                          <div aria-label="Illustrative media placeholder">
                            <span>{m.kind === "video" ? "▶" : "▧"}</span>
                            <small>{m.kind.toUpperCase()} DEMO</small>
                          </div>
                          <p>
                            <strong>{m.label}</strong>
                            {m.description}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p>
                        No advisor-approved photos or video are available for
                        this recommendation. Ask the advisor for evidence if you
                        have questions.
                      </p>
                    )}
                  </div>
                )}
                {questions[j.id] && (
                  <p className={styles.journeyQuestion}>
                    Question saved in this demo: {questions[j.id]}
                  </p>
                )}
                <div
                  className={styles.journeyChoiceButtons}
                  role="group"
                  aria-label={`Decision for ${j.name}`}
                >
                  <button
                    type="button"
                    disabled={locked}
                    aria-pressed={choices[j.id] === "approved"}
                    className={
                      choices[j.id] === "approved"
                        ? styles.journeyChoiceApproved
                        : ""
                    }
                    onClick={() =>
                      setChoices((x) => ({ ...x, [j.id]: "approved" }))
                    }
                  >
                    ✓ Approve
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    aria-pressed={choices[j.id] === "declined"}
                    className={
                      choices[j.id] === "declined"
                        ? styles.journeyChoiceDeclined
                        : ""
                    }
                    onClick={() =>
                      setChoices((x) => ({ ...x, [j.id]: "declined" }))
                    }
                  >
                    ✕ Decline
                  </button>
                </div>
              </article>
            );
          })}
          {!recommendations.length && (
            <p>No extra work was recommended during this inspection.</p>
          )}
        </section>

        <section
          className={styles.journeyCard}
          aria-labelledby="journey-summary"
        >
          <div ref={reviewRef} className={styles.journeyReviewAnchor} />
          <div className={styles.journeySectionHead}>
            <span className={styles.journeyNumber}>4</span>
            <div>
              <h2 id="journey-summary">Review your total</h2>
              <p>Nothing extra is added unless you approve it.</p>
            </div>
          </div>
          <div className={styles.journeyPriceRow}>
            <span>Original services</span>
            <strong>{money(baseTotal)}</strong>
          </div>
          <div className={styles.journeyPriceRow}>
            <span>Approved additional work</span>
            <strong>{money(selectedTotal)}</strong>
          </div>
          <div className={styles.journeyGrandTotal}>
            <span>Authorized subtotal</span>
            <strong>{money(baseTotal + selectedTotal)}</strong>
          </div>
          <p className={styles.journeySubtotalDisclaimer}>
            Before taxes and fees. This is authorized work, not a payment
            request. The final invoice includes only work that is completed and
            approved.
          </p>
          {accepted ? (
            <div className={styles.journeyDone} role="status">
              <strong>✓ Decisions saved in this demo</strong>
              <p>
                {selectedTotal
                  ? "Approved recommendations enter the technician queue. Checkout comes after completion, QC and a finalized invoice."
                  : "No additional work was approved. The original service visit continues until checkout is ready."}
              </p>
            </div>
          ) : locked ? (
            <div className={styles.journeyCallout}>
              The RO has progressed beyond work authorization. Contact your
              advisor for any changes.
            </div>
          ) : (
            <div className={styles.journeyConfirm}>
              {!reviewing && (
                <button
                  type="button"
                  className={styles.mobilePrimaryButton}
                  disabled={!allDecided || !loadedChoices}
                  onClick={review}
                >
                  Review and confirm selections →
                </button>
              )}
              {reviewing && (
                <>
                  <h3>Confirm your selections</h3>
                  <p>
                    Approve:{" "}
                    {recommendations
                      .filter((j) => choices[j.id] === "approved")
                      .map((j) => j.name)
                      .join(", ") || "No extra services"}
                  </p>
                  <p>
                    Decline:{" "}
                    {recommendations
                      .filter((j) => choices[j.id] === "declined")
                      .map((j) => j.name)
                      .join(", ") || "None"}
                  </p>
                  <label htmlFor="journey-signer">Your name</label>
                  <input
                    id="journey-signer"
                    value={signer}
                    onChange={(e) => setSigner(e.target.value)}
                    maxLength={100}
                    autoComplete="name"
                    placeholder="First and last name"
                  />
                  <label className={styles.journeyCheck}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I understand these are my selected services.
                  </label>
                  <button
                    type="button"
                    className={styles.mobilePrimaryButton}
                    disabled={!signer.trim() || !confirmed || !allDecided}
                    onClick={submitChoices}
                  >
                    Confirm decisions (demo)
                  </button>
                  <button
                    type="button"
                    className={styles.mobileTextButton}
                    onClick={() => setReviewing(false)}
                  >
                    Change selections
                  </button>
                </>
              )}
              {!allDecided && (
                <p className={styles.journeyNeedChoices}>
                  Choose Approve or Decline for each recommendation to continue.
                </p>
              )}
            </div>
          )}
          <div className={styles.journeyAfter}>
            <h3>What happens next?</h3>
            <p>
              The technician finishes authorized work → advisor checks the
              vehicle → the invoice is finalized → you can pay and pick up your
              vehicle.
            </p>
            {ready && (
              <Link
                className={styles.journeyPayLink}
                href={`/desktop-demo?screen=checkout&ro=${encodeURIComponent(roId)}`}
              >
                Open checkout →
              </Link>
            )}
          </div>
        </section>
        <p className={styles.journeyDemoDisclaimer}>
          Sample-data preview. Photos/video are placeholders; questions are
          saved only in this browser. Confirmation is not a legal electronic
          signature, and no payment is processed.
        </p>
      </div>
      {questionId !== null && (
        <div
          className={styles.mobileQuestionOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Question for service advisor"
        >
          <div className={styles.mobileQuestionSheet}>
            <h2>Ask your advisor</h2>
            <p>{recommendations.find((j) => j.id === questionId)?.name}</p>
            <label htmlFor="journey-question">
              What would you like to ask?
            </label>
            <textarea
              id="journey-question"
              value={draftQuestion}
              onChange={(e) => setDraftQuestion(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="Can you explain why this service is needed?"
            />
            <p className={styles.journeyDemoDisclaimer}>
              Demo only. This does not send a message.
            </p>
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
      )}
    </main>
  );
}
