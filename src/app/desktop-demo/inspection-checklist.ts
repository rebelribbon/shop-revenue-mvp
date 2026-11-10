export type InspectionResult = "pass" | "attention" | "not_applicable";
export type InspectionItem = {
  result?: InspectionResult;
  notes: string;
  recommendedWork: string;
};
export const inspectionPoints = [
  {
    id: "brakes",
    label: "Brake pads, rotors and hydraulic system",
    section: "Safety",
  },
  { id: "tires", label: "Tires, tread depth and pressure", section: "Safety" },
  { id: "steering", label: "Steering and suspension", section: "Safety" },
  {
    id: "lights",
    label: "Headlights, signals and brake lights",
    section: "Safety",
  },
  { id: "wipers", label: "Wipers and windshield", section: "Safety" },
  {
    id: "fluids",
    label: "Engine oil and fluid condition/levels",
    section: "Under hood",
  },
  {
    id: "battery",
    label: "Battery and charging system",
    section: "Under hood",
  },
  {
    id: "belts",
    label: "Belts, hoses and visible leaks",
    section: "Under hood",
  },
  {
    id: "filters",
    label: "Engine and cabin air filters",
    section: "Under hood",
  },
  { id: "exhaust", label: "Exhaust and underbody", section: "Under vehicle" },
  {
    id: "drivetrain",
    label: "Drivetrain and axle boots",
    section: "Under vehicle",
  },
  {
    id: "road_test",
    label: "Road test / symptom verification",
    section: "Road test",
  },
] as const;
export type InspectionPointId = (typeof inspectionPoints)[number]["id"];
export type InspectionResults = Partial<
  Record<InspectionPointId, InspectionItem>
>;
export function inspectReady(results: InspectionResults) {
  return inspectionPoints.every(({ id }) => {
    const item = results[id];
    if (!item?.result) return false;
    if (
      item.result === "attention" &&
      (!item.notes.trim() || !item.recommendedWork.trim())
    )
      return false;
    return true;
  });
}
export function inspectionRecommendations(results: InspectionResults) {
  return inspectionPoints.flatMap(({ id, label }) => {
    const item = results[id];
    return item?.result === "attention" && item.recommendedWork.trim()
      ? [
          {
            id,
            inspectionArea: label,
            name: item.recommendedWork.trim(),
            notes: item.notes.trim(),
          },
        ]
      : [];
  });
}
