import { describe, expect, it } from "vitest";
import {
  eligibleInvoiceLines,
  invoiceMatchesAuthorizedCompletedWork,
} from "@/app/desktop-demo/ro-invoice-guard";

const jobs = [
  { id: 1, name: "Oil change", price: 115, decision: "approved" as const },
  { id: 2, name: "Brake flush", price: 180, decision: "pending" as const },
  { id: 3, name: "Air filter", price: 65, decision: "declined" as const },
  { id: 4, name: "Brakes", price: 425, decision: "approved" as const },
];

describe("RO invoice guard", () => {
  it("excludes declined, undecided and unfinished work", () => {
    expect(eligibleInvoiceLines(jobs, [1, 2, 3])).toEqual([
      { id: 1, name: "Oil change", price: 115 },
    ]);
  });
  it("includes additional work only after approval and completion", () => {
    const approved = jobs.map(j => j.id === 2 ? { ...j, decision: "approved" as const } : j);
    expect(eligibleInvoiceLines(approved, [1, 2, 4])).toEqual([
      { id: 1, name: "Oil change", price: 115 },
      { id: 2, name: "Brake flush", price: 180 },
      { id: 4, name: "Brakes", price: 425 },
    ]);
  });
  it("blocks invoice finalization if approvals change after QC", () => {
    const snapshot = eligibleInvoiceLines(jobs, [1, 4]);
    expect(invoiceMatchesAuthorizedCompletedWork(snapshot, jobs, [1, 4])).toBe(true);
    expect(invoiceMatchesAuthorizedCompletedWork(snapshot, jobs.map(j => j.id === 4 ? { ...j, decision: "declined" as const } : j), [1, 4])).toBe(false);
    expect(invoiceMatchesAuthorizedCompletedWork(snapshot, jobs.map(j => j.id === 1 ? { ...j, price: 125 } : j), [1, 4])).toBe(false);
    expect(invoiceMatchesAuthorizedCompletedWork(snapshot, jobs, [1])).toBe(false);
    expect(invoiceMatchesAuthorizedCompletedWork([...snapshot, snapshot[0]],jobs,[1,4])).toBe(false);
  });
});
