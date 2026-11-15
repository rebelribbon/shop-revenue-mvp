import type { EstimateSnapshot } from "@/db/schema/m3";

type Line = EstimateSnapshot["lines"][number];

// The customer sees the new immutable estimate. This summary is an audit
// supplement: it is derived from both stored versions, never entered by staff.
export function automaticEstimateChanges(
  prior: EstimateSnapshot | null,
  current: EstimateSnapshot,
): string | null {
  if (!prior) return null;
  const changes: string[] = [];
  const oldLines = prior.lines.map((line) => ({ line, used: false }));

  for (const line of current.lines) {
    const match = oldLines.find(
      (old) =>
        !old.used &&
        old.line.kind === line.kind &&
        old.line.description === line.description,
    );
    if (!match) {
      changes.push(`Added ${line.kind}: ${line.description}`);
      continue;
    }
    match.used = true;
    const before = match.line;
    if (
      before.quantity !== line.quantity ||
      before.unitPriceCents !== line.unitPriceCents ||
      before.totalCents !== line.totalCents ||
      before.taxable !== line.taxable
    ) {
      const details: string[] = [];
      if (before.quantity !== line.quantity)
        details.push(`quantity ${before.quantity} → ${line.quantity}`);
      if (before.unitPriceCents !== line.unitPriceCents)
        details.push(
          `unit price ${money(before.unitPriceCents)} → ${money(line.unitPriceCents)}`,
        );
      if (before.totalCents !== line.totalCents)
        details.push(
          `line tot¶»§q«^