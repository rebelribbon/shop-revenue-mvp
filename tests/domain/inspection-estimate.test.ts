import { describe, expect, it } from "vitest";
import { inspectionTemplate } from "@/lib/inspection-templates";
import { withInspectionRecommendations } from "@/lib/inspection-estimate";
import type { JobInput } from "@/domain/jobs";

const job: JobInput = {
  customerId: "00000000-0000-4000-8000-000000000001",
  vehicleId: "00000000-0000-4000-8000-000000000002",
  title: "RO",
  labor: [],
  parts: [],
};

describe("advisor estimate from submitted vehicle inspection", () => {
  it("includes caution and fail findings without creating work for pass or N/A", () => {
    const points = inspectionTemplate("automotive");
    const a = points.map((point, index) => ({
      ...point,
      status: index === 0 ? "watch" as const : index === 1 ? "fix" as const :
        index === 2 ? "na" as const : "good" as const,
      note: index < 2 ? "Wear documented" : "",
      recommendedWork: index === 1 ? "Replace blades" : "",
    }));
    const draft = withInspectionRecommendations(job, a);
    expect(a).toHaveLength(40);
    expect(draft.labor).toHaveLength(2);
    expect(draft.labor[0].fromInspection).toBe(true);
    expect(draft.labor[0].description).toContain("Wear documented");
    expect(draft.labor[1].description).toContain("Replace blades");
    expect(draft.labor.every((line) => line.sellRateCents === 0)).toBe(true);
    expect(draft.labor.every((line) => line.costRateCents === null)).toBe(true);
    expect(job.labor).toHaveLength(0);
  });

  it("does not duplicate already saved or previously imported recommendations", () => {
    const [first] = inspectionTemplate("automotive");
    const item = { ...first, status: "fix" as const, note: "Chipped",
      recommendedWork: "Replace windshield" };
    const once = withInspectionRecommendations(job, [item]);
    expect(withInspectionRecommendations(once, [item]).labor).toHaveLength(1);
    expect(withInspectionRecommendations(job, [{ ...item, addedToJob: true }]).labor)
      .toHaveLength(0);
  });
});
