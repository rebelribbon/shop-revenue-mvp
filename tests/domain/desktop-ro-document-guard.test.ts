import { describe, expect, it } from "vitest";
import {
  areServiceDocumentsCurrent,
  type DocumentGuardLine,
  type DocumentGuardRecord,
  type SignedRecord,
} from "@/app/desktop-demo/ro-document-guard";

const jobs: DocumentGuardLine[] = [
  { id: 1, name: "Oil change", price: 115, decision: "approved" },
  { id: 2, name: "Brake pads", price: 425, decision: "declined" },
];
const signature = (lines: DocumentGuardLine[]): SignedRecord => ({
  name: "Customer",
  recordedAt: "2026-11-10T15:00:00.000Z",
  version: 1,
  items: lines.map((x) => x.id),
  lines: lines.map(({ id, name, price }) => ({ id, name, price })),
});
const documents: DocumentGuardRecord = {
  complaint: "Customer reports grinding noise",
  assignedTech: "Technician",
  diagnosis: "Worn pads",
  inspection: "Inspected brakes, tires and fluids",
  partsCost: "45",
  partsPrice: "80",
  laborCost: "15",
  laborPrice: "35",
  estimate: signature(jobs.filter((j) => j.decision === "approved")),
  declination: signature(jobs.filter((j) => j.decision === "declined")),
  privacy: signature([]),
};
describe("RO service document gate", () => {
  it("requires all separately signed documents and customer/tech context", () => {
    expect(areServiceDocumentsCurrent(documents, jobs)).toBe(true);
    expect(
      areServiceDocumentsCurrent({ ...documents, privacy: undefined }, jobs),
    ).toBe(false);
    expect(
      areServiceDocumentsCurrent(
        { ...documents, declination: undefined },
        jobs,
      ),
    ).toBe(false);
    expect(
      areServiceDocumentsCurrent({ ...documents, estimate: undefined }, jobs),
    ).toBe(false);
    expect(
      areServiceDocumentsCurrent({ ...documents, diagnosis: "" }, jobs),
    ).toBe(false);
    expect(
      areServiceDocumentsCurrent({ ...documents, complaint: "" }, jobs),
    ).toBe(false);
  });
  it("rejects stale approval, declination and price signatures", () => {
    expect(
      areServiceDocumentsCurrent(
        documents,
        jobs.map((j) => (j.id === 2 ? { ...j, decision: "approved" } : j)),
      ),
    ).toBe(false);
    expect(
      areServiceDocumentsCurrent(
        documents,
        jobs.map((j) => (j.id === 1 ? { ...j, price: 120 } : j)),
      ),
    ).toBe(false);
    expect(
      areServiceDocumentsCurrent(documents, [
        ...jobs,
        { id: 3, name: "Inspection", price: 40, decision: "pending" },
      ]),
    ).toBe(false);
  });
  it("does not require a declination when no item was declined", () => {
    const allApproved = [jobs[0]];
    expect(
      areServiceDocumentsCurrent(
        {
          ...documents,
          estimate: signature(allApproved),
          declination: undefined,
        },
        allApproved,
      ),
    ).toBe(true);
  });
});
