"use client";

import { useEffect, useState } from "react";
import {
  inspectionPoints,
  inspectionLabels,
  type InspectionResults,
} from "./inspection-checklist";
import styles from "./desktop-demo.module.css";

type Signature = {
  name: string;
  recordedAt: string;
  version: number;
  lines: { id: number; name: string; price: number }[];
};
type RecordData = {
  complaint?: string;
  assignedTech?: string;
  diagnosis?: string;
  inspectionResults?: InspectionResults;
  submittedInspectionAt?: string;
  estimateSentAt?: string;
  estimate?: Signature;
  declination?: Signature;
  privacy?: Signature;
  history?: string[];
};
type Bill = {
  phase?: string;
  invoiceLines?: { id: number; name: string; price: number }[];
  receipt?: { receiptNumber: string; recordedAt: string; subtotal: number };
  history?: string[];
};
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
function time(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : "Not recorded";
}
export function RoRecordsVault({ roId }: { roId: string }) {
  const [doc, setDoc] = useState<RecordData | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [loaded, setLoaded] = useState(false);
  function refresh() {
    try {
      const a = sessionStorage.getItem(
        `shop-revenue-desktop-demo-service-flow-v1:${roId}`,
      );
      const b = sessionStorage.getItem(
        `shop-revenue-desktop-demo-checkout-v1:${roId}`,
      );
      setDoc(a ? (JSON.parse(a) as RecordData) : null);
      setBill(b ? (JSON.parse(b) as Bill) : null);
    } catch {
      setDoc(null);
      setBill(null);
    }
    setLoaded(true);
  }
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) refresh();
    });
    return () => {
      active = false;
    };
  }, [roId]);
  const checked = inspectionPoints.filter(
    (item) => doc?.inspectionResults?.[item.id]?.result,
  );
  const signatureEntries = [
    ["Approved estimate", doc?.estimate],
    ["Declined-work acknowledgment", doc?.declination],
    ["Privacy acknowledgment", doc?.privacy],
  ] as const;
  return (
    <details
      className={styles.roVault}
      onToggle={(e) => {
        if (e.currentTarget.open) refresh();
      }}
    >
      <summary>RO documents, inspection & activity history</summary>
      <div className={styles.roVaultBody}>
        <p>
          This is a browser-session document register for design review, not
          durable storage or legally signed PDFs.
        </p>
        <div className={styles.roVaultGrid}>
          <section>
            <h3>Technician inspection</h3>
            <p>
              {doc?.submittedInspectionAt
                ? `Submitted ${time(doc.submittedInspectionAt)}`
                : "Not submitted"}
            </p>
            <p>
              {checked.length} of {inspectionPoints.length} items recorded
            </p>
            {doc?.diagnosis && <p>Diagnosis: {doc.diagnosis}</p>}
            {doc?.submittedInspectionAt && (
              <details>
                <summary>Review inspection points</summary>
                {checked.map((point) => {
                  const result = doc?.inspectionResults?.[point.id];
                  return (
                    <div className={styles.roVaultRow} key={point.id}>
                      <strong>{point.label}</strong>
                      <span>
                        {result?.result
                          ? inspectionLabels[result.result]
                          : "Unknown"}
                      </span>
                      {result?.notes && <p>{result.notes}</p>}
                    </div>
                  );
                })}
              </details>
            )}
          </section>
          <section>
            <h3>Customer documents</h3>
            {signatureEntries.map(([name, signed]) => (
              <div className={styles.roVaultRow} key={name}>
                <strong>{name}</strong>
                <span>
                  {signed
                    ? `Demo acknowledged · v${signed.version}`
                    : "Not on file"}
                </span>
                {signed && (
                  <>
                    <small>
                      {signed.name} · {time(signed.recordedAt)}
                    </small>
                    {signed.lines?.map((line) => (
                      <p key={line.id}>
                        {line.name} · {money(line.price)}
                      </p>
                    ))}
                  </>
                )}
              </div>
            ))}
          </section>
          <section>
            <h3>Invoice & payment receipt</h3>
            <p>
              Billing status:{" "}
              {bill?.phase?.replaceAll("_", " ") ?? "Not started"}
            </p>
            {bill?.invoiceLines?.map((line) => (
              <div className={styles.roVaultRow} key={line.id}>
                <strong>{line.name}</strong>
                <span>{money(line.price)}</span>
              </div>
            ))}
            {bill?.receipt ? (
              <div className={styles.roVaultRow}>
                <strong>{bill.receipt.receiptNumber}</strong>
                <span>Payment receipt · {time(bill.receipt.recordedAt)}</span>
                <p>{money(bill.receipt.subtotal)} subtotal (demo)</p>
              </div>
            ) : (
              <p>Receipt appears after simulated payment.</p>
            )}
          </section>
        </div>
        <section>
          <h3>Service handoff history</h3>
          {doc?.history?.map((item, i) => (
            <p className={styles.roVaultLog} key={i}>
              {item}
            </p>
          ))}
          {bill?.history?.map((item, i) => (
            <p className={styles.roVaultLog} key={`billing-${i}`}>
              {item}
            </p>
          ))}
          {!doc?.history?.length && !bill?.history?.length && (
            <p>No handoffs recorded.</p>
          )}
        </section>
        {!loaded && <p>Loading demo records…</p>}
      </div>
    </details>
  );
}
