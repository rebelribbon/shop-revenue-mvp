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
          `line total ${money(before.totalCents)} → ${money(line.totalCents)}`,
        );
      if (before.taxable !== line.taxable)
        details.push("tax treatment updated");
      changes.push(`Updated ${line.description}: ${details.join(", ")}`);
    }
  }
  for (const old of oldLines) {
    if (!old.used) changes.push(`Removed ${old.line.kind}: ${old.line.description}`);
  }
  if (prior.taxBps !== current.taxBps)
    changes.push(`Sales tax ${prior.taxBps / 100}% → ${current.taxBps / 100}%`);
  if (prior.terms !== current.terms)
    changes.push("Customer terms updated");
  if (prior.totalCents !== current.totalCents)
    changes.push(`Estimate total ${money(prior.totalCents)} → ${money(current.totalCents)}`);
  if (
    JSON.stringify(prior.inspection ?? null) !==
    JSON.stringify(current.inspection ?? null)
  ) changes.push("Inspection results updated");
  if (
    JSON.stringify(prior.photos ?? []) !==
    JSON.stringify(current.photos ?? [])
  ) changes.push("Shared inspection media updated");

  // A new version can be required simply to reissue an expired or revoked
  // link, with otherwise identical content.
  return changes.length
    ? changes.join("; ").slice(0, 2000)
    : "Customer estimate reissued with no changes to priced work";
}

const money = (cents: number) => "$" + (cents / 100).toFixed(2);
