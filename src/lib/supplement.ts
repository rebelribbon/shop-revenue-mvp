// Supplements: extra work approved after a job is invoiced is billed on an
// add-on invoice. A line counts as "already billed" when an active invoice
// on the job has the same kind, description, quantity, price and tax flag,
// matched one-for-one, so nothing is billed twice.
import type { EstimateLine } from "@/db/schema/m3";

const key = (l: EstimateLine) =>
  [l.kind, l.description, l.quantity, l.unitPriceCents, l.taxable ?? ""].join(
    "|",
  );

// Approved lines that no active invoice has billed yet.
export function unbilledLines(
  approved: EstimateLine[],
  billed: EstimateLine[],
): EstimateLine[] {
  const left = new Map<string, number>();
  for (const l of billed) left.set(key(l), (left.get(key(l)) ?? 0) + 1);
  return approved.filter((l) => {
    const n = left.get(key(l)) ?? 0;
    if (n > 0) {
      left.set(key(l), n - 1);
      return false;
    }
    return true;
  });
}

// Billed lines missing (changed or removed) from a new estimate.
export function changedBilledLines(
  billed: EstimateLine[],
  next: EstimateLine[],
): EstimateLine[] {
  return unbilledLines(billed, next);
}
