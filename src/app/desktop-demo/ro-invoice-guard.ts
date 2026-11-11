export type InvoiceWorkLine = {
  id: number;
  name: string;
  price: number;
  decision: "approved" | "pending" | "declined";
};
export type InvoiceSnapshotLine = Pick<
  InvoiceWorkLine,
  "id" | "name" | "price"
>;

/** Never bill a recommendation that has not been approved and completed. */
export function eligibleInvoiceLines(
  jobs: InvoiceWorkLine[],
  completed: readonly number[],
): InvoiceSnapshotLine[] {
  const unique = new Set<number>();
  return jobs
    .filter((line) => {
      if (
        !Number.isSafeInteger(line.id) ||
        unique.has(line.id) ||
        line.decision !== "approved" ||
        !completed.includes(line.id) ||
        !Number.isFinite(line.price) ||
        line.price < 0
      )
        return false;
      unique.add(line.id);
      return true;
    })
    .map(({ id, name, price }) => ({ id, name, price }));
}

/** Protect against changing approvals, prices, or work after QC. */
export function invoiceMatchesAuthorizedCompletedWork(
  snapshot: InvoiceSnapshotLine[],
  jobs: InvoiceWorkLine[],
  completed: readonly number[],
): boolean {
  if (
    !snapshot.length ||
    new Set(snapshot.map((x) => x.id)).size !== snapshot.length
  )
    return false;
  const eligible = eligibleInvoiceLines(jobs, completed);
  return (
    eligible.length === snapshot.length &&
    eligible.every((line) =>
      snapshot.some(
        (x) =>
          x.id === line.id && x.name === line.name && x.price === line.price,
      ),
    )
  );
}
