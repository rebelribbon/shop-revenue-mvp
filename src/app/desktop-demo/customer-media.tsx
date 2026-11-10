"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./desktop-demo.module.css";
import { roRecords, type DemoJob } from "./ro-workspace";

type SampleMedia = {
  id: string; label: string; description: string; kind: "photo" | "video";
  approved: boolean; jobId: number;
};
const mediaSeeds: Record<string, SampleMedia[]> = {
  "RO-10482": [
    { id: "brakes", label: "Worn front brake pads", description: "Pad material is nearly worn out", kind: "photo", approved: true, jobId: 1 },
    { id: "rotors", label: "Rotor surface", description: "Deep grooves visible on the rotor", kind: "photo", approved: false, jobId: 1 },
    { id: "walkthrough", label: "Technician walkthrough", description: "Inspection explanation video", kind: "video", approved: false, jobId: 2 },
  ],
  "RO-10193": [
    { id: "filter", label: "Air filter inspection", description: "Heavy debris in old engine filter", kind: "photo", approved: false, jobId: 3 },
  ],
  "RO-09914": [
    { id: "battery", label: "Battery test result", description: "Voltage reading below specification", kind: "photo", approved: true, jobId: 1 },
  ],
};
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export function ShareMediaDemo({ roId, customerOnly = false }: { roId: string; customerOnly?: boolean }) {
  const [media, setMedia] = useState<SampleMedia[]>(() => [...(mediaSeeds[roId] ?? [])]);
  const existing = roRecords[roId as keyof typeof roRecords];
  const [jobs, setJobs] = useState<DemoJob[]>(() => [...(existing?.jobs ?? [])]);
  const [hydrated, setHydrated] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const mediaKey = `shop-revenue-desktop-demo-share-v1:${roId}`;
  const jobsKey = `shop-revenue-desktop-demo-ro-v2:${roId}`;
  const visible = customerOnly ? media.filter((item) => item.approved) : media;
  const urlPath = `/desktop-demo?screen=customer-link&ro=${encodeURIComponent(roId)}`;

  useEffect(() => {
    let live = true;
    let stored: SampleMedia[] | null = null;
    let storedJobs: DemoJob[] | null = null;
    try {
      const raw = sessionStorage.getItem(mediaKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((v) =>
          v && typeof v.id === "string" && typeof v.label === "string" &&
          typeof v.description === "string" && typeof v.approved === "boolean" &&
          ["photo", "video"].includes(v.kind) && typeof v.jobId === "number"
        )) stored = parsed as SampleMedia[];
      }
      const rawJobs = sessionStorage.getItem(jobsKey);
      if (rawJobs) {
        const parsed: unknown = JSON.parse(rawJobs);
        if (Array.isArray(parsed) && parsed.every((v) => v && typeof v.id === "number" && typeof v.price === "number" && typeof v.name === "string" && ["approved", "declined", "pending"].includes(v.decision))) {
          storedJobs = parsed as DemoJob[];
        }
      }
    } catch { /* Sample preview may run without session storage. */ }
    queueMicrotask(() => {
      if (!live) return;
      if (stored) setMedia(stored);
      if (storedJobs) setJobs(storedJobs);
      setHydrated(true);
    });
    return () => { live = false; };
  }, [mediaKey, jobsKey]);

  useEffect(() => {
    if (!hydrated || customerOnly) return;
    try { sessionStorage.setItem(mediaKey, JSON.stringify(media)); }
    catch { /* Preview only. */ }
  }, [media, mediaKey, hydrated, customerOnly]);

  function setApproval(id: string, approved: boolean) {
    setMedia((old) => old.map((m) => m.id === id ? { ...m, approved } : m));
  }
  function copyPreview() {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(new URL(urlPath, window.location.origin).toString())
      .then(() => setCopyMessage("Demo preview link copied. This is not a live, cross-device customer share."))
      .catch(() => setCopyMessage("Open the customer preview link and copy its address."));
  }
  const subtotal = jobs.filter((j) => j.decision === "approved").reduce((sum, j) => sum + j.price, 0);
  return customerOnly ? (
    <main id="main-content" className={styles.shareCustomerPage}>
      <div className={styles.shareCustomerHeader}><strong>◆ SHOP REVENUE</strong><span>DEMO CUSTOMER PORTAL · FICTIONAL RECORDS</span></div>
      <div className={styles.shareCustomerBody}>
        <p className={styles.eyebrow}>YOUR SERVICE VISIT · {roId}</p>
        <h1>{existing?.title ?? "Vehicle service visit"}</h1>
        <p>{existing?.vehicle ?? "Vehicle"} · John Smith</p>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Service status and selections</h2><p>Work approved for this visit, and recommendations that are not authorized.</p></div></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Service</th><th>Decision</th><th>Price</th></tr></thead><tbody>
            {jobs.map(j=><tr key={j.id}><td><strong>{j.name}</strong></td><td>{j.decision === "approved" ? "Approved" : j.decision === "declined" ? "Declined" : "Awaiting decision"}</td><td>{money(j.price)}</td></tr>)}
            {!jobs.length && <tr><td colSpan={3}>No services on this demo RO yet.</td></tr>}
          </tbody></table></div>
          <div className={styles.sectionTotal}><span>Currently approved subtotal (before tax/fees)</span><strong>{money(subtotal)}</strong></div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Photos & videos shared by your advisor</h2><p>Only media explicitly approved for sharing is shown here.</p></div><span className={styles.pill}>{visible.length} shared</span></div>
          <div className={styles.shareMediaGrid}>{visible.map(item=><MediaTile key={item.id} item={item} />)}</div>
          {!visible.length && <p className={styles.vehicleEmpty}>Your advisor has not shared photos or videos for this repair order.</p>}
        </section>
        <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Estimates, documents & payments</h2><p>In the production customer link, signed estimates, invoices and payment links will live here.</p></div></div></section>
        <p className={styles.estimateDisclaimer}>Design demo only. This page uses fictional data and session-only sample decisions. It does not retrieve real customer records, display actual uploaded files, synchronize between devices, or accept payments.</p>
      </div>
    </main>
  ) : (
    <section className={styles.panel} aria-label="Technician media awaiting advisor approval">
      <div className={styles.panelHeader}>
        <div><h2>Inspection Media · Advisor Review</h2><p>Technician uploads remain private until you approve each item.</p></div>
        <span className={styles.pill}>{media.filter(m => !m.approved).length} awaiting review</span>
      </div>
      <div className={styles.shareMediaGrid}>
        {media.map(item => (
          <div className={styles.shareReviewTile} key={item.id}>
            <MediaTile item={item} />
            <div className={styles.shareMediaAction}>
              <span className={item.approved ? styles.approvedTag : styles.pendingTag}>{item.approved ? "Shared with customer" : "Private · Advisor review"}</span>
              <button type="button" className={item.approved ? styles.removeApprovalButton : styles.addButton} onClick={() => setApproval(item.id, !item.approved)}>
                {item.approved ? "Revoke sharing" : "Approve for customer"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {!media.length && <p className={styles.vehicleEmpty}>No sample inspection media on this RO.</p>}
      <div className={styles.estimateFooter}>
        <Link className={styles.returnButton} href={urlPath}>Open customer view ↗</Link>
        <button type="button" onClick={copyPreview} className={styles.addButton}>Copy demo preview link</button>
      </div>
      {copyMessage && <p className={styles.note} role="status">{copyMessage}</p>}
      <div className={styles.note}>Sample media placeholders only, not uploaded customer files. The approval toggle persists in this browser session; a real customer share must use the authenticated shop's server-side approval and a revocable private link.</div>
    </section>
  );
}
function MediaTile({ item }: { item: SampleMedia }) {
  return <figure className={styles.shareTile}>
    <div className={styles.sharePlaceholder} aria-label={item.kind === "photo" ? "Illustrative photo placeholder" : "Illustrative video placeholder"}>
      <span aria-hidden="true">{item.kind === "photo" ? "▧" : "▶"}</span>
      <small>{item.kind === "photo" ? "PHOTO PLACEHOLDER" : "VIDEO PLACEHOLDER"}</small>
    </div>
    <figcaption><strong>{item.label}</strong><span>{item.description}</span></figcaption>
  </figure>;
}
