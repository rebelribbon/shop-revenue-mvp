// The RO's name when it's opened at check-in: the customer's first concern,
// shortened. The advisor can rename it when building the estimate.
export function checkInTitle(concerns: string) {
  const first =
    concerns
      .trim()
      .split(/\n|(?<=[.!?])\s/)[0]
      ?.trim()
      .replace(/[.!?]+$/, "") ?? "";
  if (!first) return "Check-in";
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first;
}
