// Job costing uses integer cents and hundredths of an hour. Customer totals
// exclude internal costs. Missing actual time remains unknown rather than zero.
export type JobPart = {
  quantity: number;
  unitCostCents: number;
  unitPriceCents: number;
};
export type JobLabor = {
  estimatedHoursHundredths: number;
  actualHoursHundredths: number | null;
  sellRateCents: number;
  costRateCents: number;
};
function integer(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}
function sum(values: number[]) {
  return integer(values.reduce((a, b) => a + b, 0), "total");
}
function multiply(a: number, b: number, divisor = 1) {
  const product = BigInt(a) * BigInt(b);
  return integer(Number((product + BigInt(divisor / 2 | 0)) / BigInt(divisor)), "amount");
}
export function calculateJob(parts: JobPart[], labor: JobLabor[]) {
  const partCosts: number[] = [];
  const partSales: number[] = [];
  for (const part of parts) {
    integer(part.quantity, "quantity");
    integer(part.unitCostCents, "part cost");
    integer(part.unitPriceCents, "part price");
    partCosts.push(multiply(part.quantity, part.unitCostCents));
    partSales.push(multiply(part.quantity, part.unitPriceCents));
  }
  const estimatedCosts: number[] = [];
  const actualCosts: number[] = [];
  const laborSales: number[] = [];
  let actualComplete = true;
  for (const line of labor) {
    integer(line.estimatedHoursHundredths, "estimated hours");
    integer(line.sellRateCents, "labor sell rate");
    integer(line.costRateCents, "labor cost rate");
    estimatedCosts.push(multiply(line.estimatedHoursHundredths, line.costRateCents, 100));
    laborSales.push(multiply(line.estimatedHoursHundredths, line.sellRateCents, 100));
    if (line.actualHoursHundredths === null) actualComplete = false;
    else {
      integer(line.actualHoursHundredths, "actual hours");
      actualCosts.push(multiply(line.actualHoursHundredths, line.costRateCents, 100));
    }
  }
  const partsCostCents = sum(partCosts);
  const partsPriceCents = sum(partSales);
  const laborPriceCents = sum(laborSales);
  const subtotalCents = sum([partsPriceCents, laborPriceCents]);
  const estimatedCostCents = sum([partsCostCents, sum(estimatedCosts)]);
  const actualCostCents = actualComplete ? sum([partsCostCents, sum(actualCosts)]) : null;
  return {
    partsCostCents, partsPriceCents, laborPriceCents, subtotalCents,
    estimatedCostCents, actualCostCents,
    estimatedGrossProfitCents: subtotalCents - estimatedCostCents,
    actualGrossProfitCents: actualCostCents === null ? null : subtotalCents - actualCostCents,
    // Gross margin is before shop overhead, taxes and payment fees.
    estimatedMarginBps: subtotalCents === 0 ? null : Math.round((subtotalCents - estimatedCostCents) * 10000 / subtotalCents),
  };
}

