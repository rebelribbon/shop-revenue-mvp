import Link from "next/link";
import type { Metadata } from "next";
import { FileCabinet } from "@/components/file-cabinet";
import type { CabinetItem } from "@/domain/documents";

export const metadata: Metadata = {
  title: "Documents workspace preview | Shop Revenue",
  robots: { index: false, follow: false },
};
export const dynamic = "force-static";

const sample: CabinetItem[] = [
  {
    id: "sample-estimate",
    group: "Created for this job",
    title: "Estimate · version 1",
    detail: "$1,284.75",
    at: new Date("2026-11-08T14:00:00Z"),
    status: "Ready to send",
    href: null,
    preview: {
      type: "estimate",
      shopName: "Sample Auto Service",
      customerName: "Alex Example",
      subject: "2019 Ford F-150 · Brake service",
      totalCents: 128475,
      taxCents: 3475,
      lines: [
        { id: "a", description: "Front brake pads", quantity: 1, unitPriceCents: 23500, totalCents: 23500 },
        { id: "b", description: "Front brake rotors", quantity: 2, unitPriceCents: 18900, totalCents: 37800 },
        { id: "c", description: "Brake labor", quantity: 1, unitPriceCents: 63700, totalCents: 63700 },
      ],
    },
  },
  {
    id: "sample-work-auth",
    group: "Signed & sent",
    title: "Work authorization",
    detail: "Customer signature",
    at: new Date("2026-11-08T14:01:00Z"),
    status: "Prepared",
    href: null,
    documentId: "10000000-0000-4000-8000-000000000001",
    preview: {
      type: "agreement",
      shopName: "Sample Auto Service",
      customerName: "Alex Example",
      body: "I authorize the shop to perform the work listed in the attached estimate. I understand that any additional work or pricing requires a new authorization. The work and price have been prepared by the shop.",
      fields: [{ label: "I have reviewed the work and estimated price", type: "checkbox" }],
    },
  },
  {
    id: "sample-inspection",
    group: "Signed & sent",
    title: "Vehicle inspection checklist",
    detail: "Customer acknowledgment",
    at: new Date("2026-11-08T14:02:00Z"),
    status: "Prepared",
    href: null,
    documentId: "10000000-0000-4000-8000-000000000002",
    preview: {
      type: "agreement",
      shopName: "Sample Auto Service",
      body: "Vehicle: 2019 Ford F-150. Front brakes require service. Tires, lights, and fluid levels have been inspected. The customer acknowledges receiving the inspection summary.",
      fields: [{ label: "Inspection results reviewed", type: "checkbox" }],
    },
  },
  {
    id: "sample-privacy",
    group: "Signed & sent",
    title: "Privacy notice",
    detail: "Customer copy",
    at: new Date("2026-11-08T14:03:00Z"),
    status: "Signed",
    href: null,
    preview: {
      type: "agreement",
      shopName: "Sample Auto Service",
      body: "This sample explains how a shop may use customer contact details for estimates, service updates, and payment communications. It is illustrative only, not a real legal document.",
    },
  },
  {
    id: "sample-photo",
    group: "Added files",
    title: "Brake inspection photos",
    detail: "Photo attachment",
    at: new Date("2026-11-08T14:04:00Z"),
    status: "Filed",
    href: null,
  },
];

export default function DocumentsPreviewPage() {
  return (
    <main className="docs-public-demo" id="main-content" tabIndex={-1}>
      <header className="docs-public-heading">
        <div>
          <span className="docs-demo-eyebrow">SHOP REVENUE · LAYOUT PREVIEW</span>
          <h1>Brake Service · Job #10042</h1>
          <p>Alex Example · 2019 Ford F-150 · Sample Auto Service</p>
        </div>
        <span className="docs-demo-status">Sample data · No login required</span>
      </header>
      <div className="docs-demo-layout">
        <nav className="docs-demo-nav" aria-label="Sample job sections">
          <span>Job Setup</span>
          <strong aria-current="page">Documents</strong>
          <span>Payment</span>
          <span>History</span>
        </nav>
        <div className="docs-demo-main">
          <div className="docs-demo-summary">
            <span><small>Customer</small><strong>Alex Example</strong></span>
            <span><small>Vehicle</small><strong>2019 Ford F-150</strong></span>
            <span><small>Estimated total</small><strong>$1,284.75</strong></span>
            <span><small>Approval</small><strong>Ready to share</strong></span>
          </div>
          <FileCabinet
            items={sample}
            readOnly
            demoMode
            customerEmail={null}
            customerPhone={null}
            timeZone="America/Chicago"
          />
          <p className="muted">This is a visual and interaction preview with invented data. No document is sent, signed, or paid from this page.</p>
          <Link href="https://www.shoprevenue.app">Shop Revenue</Link>
        </div>
      </div>
    </main>
  );
}
