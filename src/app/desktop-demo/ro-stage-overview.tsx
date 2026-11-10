"use client";

import Link from "next/link";
import { useDemoCheckout } from "./ro-checkout-demo";
import type { Stage } from "./ro-service-flow";
import styles from "./desktop-demo.module.css";

type Props = {
  roId: string;
  stage: Stage;
  authorized: boolean;
  approved: number;
  pending: number;
  declined: number;
};

const steps = [
  { label: "Intake", owner: "Advisor" },
  { label: "Technician", owner: "Advisor" },
  { label: "40-point inspection", owner: "Technician" },
  { label: "Price estimate", owner: "Advisor" },
  { label: "Share estimate", owner: "Advisor" },
  { label: "Sign & authorize", owner: "Customer" },
  { label: "Complete repairs", owner: "Technician" },
  { label: "Quality check", owner: "Advisor" },
  { label: "Invoice & payment", owner: "Customer" },
  { label: "Vehicle delivery", owner: "Advisor" },
] as const;
const stageIndices: Record<Stage, number> = {
  intake: 0,
  assignment: 1,
  inspection: 2,
  pricing: 3,
  send: 4,
  authorization: 5,
};
const checkoutIndex: Record<string, number> = {
  working: 6,
  qc: 7,
  invoice_draft: 8,
  invoice_ready: 8,
  paid: 9,
  delivered: 10,
};

export function RoStageOverview({
  roId,
  stage,
  authorized,
  approved,
  pending,
  declined,
}: Props) {
  const { state, loaded } = useDemoCheckout(roId);
  const active =
    authorized && loaded
      ? (checkoutIndex[state.phase] ?? 6)
      : stageIndices[stage];
  const complete = authorized && loaded && state.phase === "delivered";
  const next = steps[Math.min(active, steps.length - 1)];
  return (
    <section
      className={styles.roStageCard}
      aria-label="Repair order progression"
    >
      <div className={styles.roStageSummary}>
        <div>
          <span className={styles.eyebrow}>
            CURRENT RO MILESTONE · {Math.min(active + 1, 10)} / 10
          </span>
          <h2>{complete ? "Delivered · RO closed" : next.label}</h2>
          <p>
            {complete
              ? "All work, payment and handoff recorded."
              : `Next action belongs to: ${next.owner}.`}
          </p>
        </div>
        <div className={styles.roStageCounts}>
          <span>{approved} approved</span>
          <span>{pending} pending</span>
          <span>{declined} declined</span>
        </div>
      </div>
      <div className={styles.roStageProgress} aria-label="Overall RO progress">
        {steps.map((step, i) => (
          <div
            key={step.label}
            className={
              i < active || complete
                ? styles.roStagePast
                : i === active
                  ? styles.roStageNow
                  : styles.roStageFuture
            }
            title={step.label}
          >
            <span>{i < active || complete ? "✓" : i + 1}</span>
            <small>{step.label}</small>
          </div>
        ))}
      </div>
      {active >= 5 && (
        <Link
          href={`/desktop-demo?screen=customer-link&ro=${encodeURIComponent(roId)}`}
          className={styles.roStageCustomerLink}
        >
          Open customer review ↗
        </Link>
      )}
      <p className={styles.roStageDisclaimer}>
        Sample-data workflow; the latest stage is stored only within this
        browser session.
      </p>
    </section>
  );
}
