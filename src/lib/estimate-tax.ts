import type { EstimateLine } from "@/db/schema/m3";
// Missing flags belong to legacy frozen documents and retain their original tax basis.
export function estimateTotals(lines: EstimateLine[], taxBps: number) {
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const taxableCents = lines
    .filter((line) => line.taxable !== false)
    .reduce((sum, line) => sum + line.totalCents, 0);
  const taxCents = Math.round((taxableCents * taxBps) / 10000);
  return {
    subtotalCents,
    taxableCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}
