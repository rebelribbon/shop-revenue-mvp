export type SignedItem = { id: number; name: string; price: number };
export type SignedRecord = {
  name: string;
  recordedAt: string;
  version: number;
  items: number[];
  lines?: SignedItem[];
};
export type DocumentGuardLine = SignedItem & {
  decision: "approved" | "pending" | "declined";
};
export type DocumentGuardRecord = {
  complaint: string;
  assignedTech: string;
  diagnosis: string;
  inspection: string;
  partsCost: string;
  partsPrice: string;
  laborCost: string;
  laborPrice: string;
  estimate?: SignedRecord;
  declination?: SignedRecord;
  privacy?: SignedRecord;
};
const sameLines = (actual: SignedItem[], expected: SignedItem[]) => {
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort((x, y) => x.id - y.id);
  const b = [...expected].sort((x, y) => x.id - y.id);
  return a.every(
    (l, i) =>
      l.id === b[i].id && l.name === b[i].name && l.price === b[i].price,
  );
};
/** A signed demo document is not legally binding. This checks exact signed RO contents. */
export function areServiceDocumentsCurrent(
  record: DocumentGuardRecord | undefined,
  jobs: DocumentGuardLine[],
): boolean {
  if (
    !record ||
    !record.complaint.trim() ||
    !record.assignedTech.trim() ||
    !record.diagnosis.trim() ||
    !record.inspection.trim()
  )
    return false;
  if (jobs.some((j) => j.decision === "pending")) return false;
  if (!jobs.every((j) => Number.isFinite(j.price) && j.price >= 0))
    return false;
  const approved = jobs.filter((j) => j.decision === "approved");
  const declined = jobs.filter((j) => j.decision === "declined");
  const signed = (s: SignedRecord | undefined, lines: SignedItem[]) =>
    !!s &&
    !!s.name.trim() &&
    !!s.recordedAt &&
    Array.isArray(s.lines) &&
    sameLines(s.lines, lines);
  return (
    approved.length > 0 &&
    signed(record.estimate, approved) &&
    (declined.length === 0 || signed(record.declination, declined)) &&
    !!record.privacy?.name.trim() &&
    !!record.privacy?.recordedAt
  );
}
