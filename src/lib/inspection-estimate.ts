import type { JobInput } from "@/domain/jobs";
import type { InspectionItem } from "@/lib/inspection-templates";

/**
 * Build an advisor-only, UNSAVED estimate draft from submitted inspection
 * findings. Pricing is deliberately left for the advisor to set.
 *
 * Pass/N/A do not create chargeable lines. Caution/Fail remain visible in the
 * inspection itself even when the advisor elects not to quote a repair.
 */
export function withInspectionRecommendations(
  initial: JobInput,
  items: InspectionItem[],
): JobInput {
  const existing = new Set(
    initial.labor.map((line) => line.description.trim().toLocaleLowerCase()),
  );
  const labor = [...initial.labor];
  for (const item of items) {
    if (item.status !== "watch" && item.status !== "fix") continue;
    if (item.addedToJob) continue;
    const recommendation = (item.recommendedWork || item.note).trim();
    if (!recommendation) continue;
    const description = (item.label + ": " + recommendation).slice(0, 200);
    const key = description.toLocaleLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    labor.push({
      description,
      fromInspection: true,
      estimatedHoursHundredths: item.hoursHundredths || 100,
      actualHoursHundredths: null,
      sellRateCents: 0,
      costRateCents: null,
    });
  }
  return { ...initial, labor };
}
