export const businessTypes = [
  "automotive",
  "hvac",
  "plumbing",
  "home_improvement",
  "handyman",
  "landscaping",
  "cleaning",
  "pool",
  "pest_control",
  "other_home_service",
] as const;
export type BusinessType = (typeof businessTypes)[number];
export const businessTypeLabels: Record<BusinessType, string> = {
  automotive: "Automotive repair",
  hvac: "HVAC",
  plumbing: "Plumbing",
  home_improvement: "Home improvement / remodeling",
  handyman: "Handyman",
  landscaping: "Landscaping & lawn care",
  cleaning: "Cleaning",
  pool: "Pool service",
  pest_control: "Pest control",
  other_home_service: "Other home services",
};
export function businessTypeLabel(type: string = "automotive") {
  return businessTypeLabels[
    businessTypes.find((value) => value === type) ?? "automotive"
  ];
}
export function isAutomotive(type: string) {
  return type === "automotive";
}
export function workspaceLabels(type: string) {
  return isAutomotive(type)
    ? {
        assets: "Vehicles",
        materials: "Parts",
        jobs: "Jobs",
        newJob: "New job",
        example: "Brakes, diagnosis, scheduled service",
      }
    : {
        assets: "Properties & equipment",
        materials: "Materials",
        jobs: "Jobs",
        newJob: "New job",
        example:
          type === "hvac"
            ? "AC repair, seasonal tune-up, system installation"
            : type === "plumbing"
              ? "Leak repair, water heater, drain service"
              : type === "landscaping"
                ? "Weekly mowing, cleanups, planting"
                : type === "cleaning"
                  ? "Weekly cleaning, deep clean, move-out"
                  : type === "pool"
                    ? "Weekly pool service, repairs, openings"
                    : type === "pest_control"
                      ? "Quarterly treatment, inspections"
                      : "Repair, installation, renovation",
      };
}

// Trades whose work is mostly recurring; their job form starts on "Repeats".
export const recurringFirst = (type: string) =>
  ["landscaping", "cleaning", "pool", "pest_control"].includes(type);
