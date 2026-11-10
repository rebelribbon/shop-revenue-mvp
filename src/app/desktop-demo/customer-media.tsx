"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./desktop-demo.module.css";
import { CustomerMobileFlow, type CustomerLine } from "./customer-mobile-flow";
type PublicJob = CustomerLine;
const safeROs: Record<
  string,
  { title: string; vehicle: string; jobs: PublicJob[] }
> = {
  "RO-10482": {
    title: "Brake Service",
    vehicle: "2021 Ford F-150",
    jobs: [
      {
        id: 1,
        name: "Front brake pads and rotors",
        price: 425,
        decision: "approved",
      },
      { id: 2, name: "Brake fluid flush", price: 180, decision: "pending" },
      {
        id: 3,
        name: "Multi-point inspection",
        price: 80,
        decision: "approved",
      },
      {
        id: 4,
        name: "Cabin air filter replacement",
        price: 65,
        decision: "declined",
      },
    ],
  },
  "RO-10193": {
    title: "Oil Change & Inspection",
    vehicle: "2021 Ford F-150",
    jobs: [
      {
        id: 1,
        name: "Engine oil and filter change",
        price: 115,
        decision: "approved",
      },
      { id: 2, name: "Tire rotation", price: 45, decision: "approved" },
      {
        id: 3,
        name: "Air filter replacement",
        price: 55,
        decision: "declined",
      },
    ],
  },
  "RO-09914": {
    title: "Battery Replacement",
    vehicle: "2018 Honda Accord",
    jobs: [
      { id: 1, name: "Battery replacement", price: 285, decision: "approved" },
      {
        id: 2,
        name: "Charging system diagnostic",
        price: 89,
        decision: "approved",
      },
      {
        id: 3,
        name: "Clean corroded terminals",
        price: 35,
        decision: "pending",
      },
    ],
  },
};

type SampleMedia = {
  id: string;
  label: string;
  description: string;
  kind: "photo" | "video";
  approved: boolean;
  jobId: number;
};
const mediaSeeds: Record<string, SampleMedia[]> = {
  "RO-10482": [
    {
      id: "brakes",
      label: "Worn front brake pads",
      description: "Pad material is nearly worn out",
      kind: "photo",
      approved: true,
      jobId: 1,
    },
    {
      id: "rotors",
      label: "Rotor surface",
      description: "Deep grooves visible on the rotor",
      kind: "photo",
      approved: false,
      jobId: 1,
    },
    {
      id: "flush-test",
      label: "Brake fluid condition",
      description: "Inspection showed moisture in the brake fluid.",
      kind: "photo",
      approved: true,
      jobId: 2,
    },
    {
      id: "air-filter",
      label: "Cabin filter condition",
      description: "Technician documented dust and debris in the filter.",
      kind: "photo",
      approved: true,
      jobId: 4,
    },
    {
      id: "walkthrough",
      label: "Technician walkthrough",
      description: "Inspection explanation video",
      kind: "video",
      approved: false,
      jobId: 2,
    },
  ],
  "RO-10193": [
    {
      id: "filter",
      label: "Air filter inspection",
      description: "Heavy debris in old engine filter",
      kind: "photo",
      approved: false,
      jobId: 3,
    },
  ],
  "RO-09914": [
    {
      id: "battery",
      label: "Battery test result",
      description: "Voltage reading below specification",
      kind: "photo",
      approved: true,
      jobId: 1,
    },
  ],
};
const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );

export function ShareMediaDemo({
  roId,
  customerOnly = false,
}: {
  roId: string;
  customerOnly?: boolean;
}) {
  const [media, setMedia] = useState<SampleMedia[]>(() => [
    ...(mediaSeeds[roId] ?? []),
  ]);
  const existing = safeROs[roId];
  const [jobs, setJobs] = useState<PublicJob[]>(() => [
    ...(existing?.jobs ?? []),
  ]);
  const [hydrated, setHydrated] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const mediaKey = `shop-revenue-desktop-demo-share-v1:${roId}`;
  const jobsKey = `shop-revenue-desktop-demo-ro-v2:${roId}`;
  const visible = customerOnly ? media.filter((item) => item.approved) : media;
  const urlPath = `/desktop-demo?screen=customer-link&ro=${encodeURIComponent(roId)}`;

  useEffect(() => {
    let live = true;
    let stored: SampleMedia[] | null = null;
    let storedJobs: PublicJob[] | null = null;
    try {
      const raw = sessionStorage.getItem(mediaKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (v) =>
              v &&
              typeof v.id === "string" &&
              typeof v.label === "string" &&
              typeof v.description === "string" &&
              typeof v.approved === "boolean" &&
              ["photo", "video"].includes(v.kind) &&
              typeof v.jobId === "number",
          )
        )
          stored = parsed as SampleMedia[];
      }
      const rawJobs = sessionStorage.getItem(jobsKey);
      if (rawJobs) {
        const parsed: unknown = JSON.parse(rawJobs);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (v) =>
              v &&
              typeof v.id === "number" &&
              typeof v.price === "number" &&
              typeof v.name === "string" &&
              ["approved", "declined", "pending"].includes(v.decision),
          )
        ) {
          storedJobs = (parsed as PublicJob[]).map((j) => ({
            id: j.id,
            name: j.name,
            price: j.price,
            decision: j.decision,
            origin: j.origin,
          }));
        }
      }
    } catch {
      /* Sample preview may run without session storage. */
    }
    queueMicrotask(() => {
      if (!live) return;
      if (stored) setMedia(stored);
      if (storedJobs) setJobs(storedJobs);
      setHydrated(true);
    });
    return () => {
      live = false;
    };
  }, [mediaKey, jobsKey]);

  useEffect(() => {
    if (!hydrated || customerOnly) return;
    try {
      sessionStorage.setItem(mediaKey, JSON.stringify(media));
    } catch {
      /* Preview only. */
    }
  }, [media, mediaKey, hydrated, customerOnly]);

  function setApproval(id: string, approved: boolean) {
    setMedia((old) => old.map((m) => (m.id === id ? { ...m, approved } : m)));
  }
  function copyPreview() {
    if (typeof window === "undefined") return;
    navigator.clipboard
      .writeText(new URL(urlPath, window.location.origin).toString())
      .then(() =>
        setCopyMessage(
          "Demo preview link copied. This is not a live, cross-device customer share.",
        ),
      )
      .catch(() =>
        setCopyMessage("Open the customer preview link and copy its address."),
      );
  }
  const subtotal = jobs
    .filter((j) => j.decision === "approved")
    .reduce((sum, j) => sum + j.price, 0);
  function saveCustomerSelections(
    choices: Record<number, "approved" | "declined">,
    questions: Record<number, string>,
  ) {
    const requestedDefaults: Record<string, number[]> = {
      "RO-10482": [1, 3],
      "RO-10193": [1],
      "RO-09914": [1, 2],
    };
    const baseIds = requestedDefaults[roId] ?? [];
    const updated = jobs.map((j) => {
      if (j.origin === "requested" || (!j.origin && baseIds.includes(j.id)))
        return j;
      return choices[j.id] ? { ...j, decision: choices[j.id] } : j;
    });
    setJobs(updated);
    try {
      const raw = sessionStorage.getItem(jobsKey);
      const existingRows: unknown = raw ? JSON.parse(raw) : null;
      const oldRows = Array.isArray(existingRows) ? existingRows : jobs;
      // Preserve shop-side internal costs and notes; change only decisions.
      const next = oldRows.map((j: PublicJob) => {
        const choice = updated.find((item) => item.id === j.id);
        return choice ? { ...j, decision: choice.decision } : j;
      });
      sessionStorage.setItem(jobsKey, JSON.stringify(next));
      sessionStorage.setItem(
        `shop-revenue-desktop-demo-questions:${roId}`,
        JSON.stringify(questions),
      );
    } catch {
      // Demo state is only stored in this browser.
    }
  }
  return customerOnly ? (
    <CustomerMobileFlow
      roId={roId}
      title={existing?.title ?? "Vehicle service visit"}
      vehicle={existing?.vehicle ?? "Vehicle"}
      jobs={jobs}
      media={visible}
      onSubmit={saveCustomerSelections}
    />
  ) : (
    <section
      className={styles.panel}
      aria-label="Technician media awaiting advisor approval"
    >
      <div className={styles.panelHeader}>
        <div>
          <h2>Inspection Media · Advisor Review</h2>
          <p>Technician uploads remain private until you approve each item.</p>
        </div>
        <span className={styles.pill}>
          {media.filter((m) => !m.approved).length} awaiting review
        </span>
      </div>
      <div className={styles.shareMediaGrid}>
        {media.map((item) => (
          <div className={styles.shareReviewTile} key={item.id}>
            <MediaTile item={item} />
            <div className={styles.shareMediaAction}>
              <span
                className={
                  item.approved ? styles.approvedTag : styles.pendingTag
                }
              >
                {item.approved
                  ? "Shared with customer"
                  : "Private · Advisor review"}
              </span>
              <button
                type="button"
                className={
                  item.approved ? styles.removeApprovalButton : styles.addButton
                }
                onClick={() => setApproval(item.id, !item.approved)}
              >
                {item.approved ? "Revoke sharing" : "Approve for customer"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {!media.length && (
        <p className={styles.vehicleEmpty}>
          No sample inspection media on this RO.
        </p>
      )}
      <div className={styles.estimateFooter}>
        <Link className={styles.returnButton} href={urlPath}>
          Open customer view ↗
        </Link>
        <button
          type="button"
          onClick={copyPreview}
          className={styles.addButton}
        >
          Copy demo preview link
        </button>
      </div>
      {copyMessage && (
        <p className={styles.note} role="status">
          {copyMessage}
        </p>
      )}
      <div className={styles.note}>
        Sample media placeholders only, not uploaded customer files. The
        approval toggle persists in this browser session; a real customer share
        must use the authenticated shop’s server-side approval and a revocable
        private link.
      </div>
    </section>
  );
}
function MediaTile({ item }: { item: SampleMedia }) {
  return (
    <figure className={styles.shareTile}>
      <div
        className={styles.sharePlaceholder}
        aria-label={
          item.kind === "photo"
            ? "Illustrative photo placeholder"
            : "Illustrative video placeholder"
        }
      >
        <span aria-hidden="true">{item.kind === "photo" ? "▧" : "▶"}</span>
        <small>
          {item.kind === "photo" ? "PHOTO PLACEHOLDER" : "VIDEO PLACEHOLDER"}
        </small>
      </div>
      <figcaption>
        <strong>{item.label}</strong>
        <span>{item.description}</span>
      </figcaption>
    </figure>
  );
}
