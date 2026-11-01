export const businessTypes = [
  "automotive",
  "hvac",
  "plumbing",
  "home_improvement",
  "handyman",
  "other_home_service",
] as const;
export type BusinessType = (typeof businessTypes)[number];
export const businessTypeLabels: Record<BusinessType, string> = {
  automotive: "Automotive repair",
  hvac: "HVAC",
  plumbing: "Plumbing",
  home_improvement: "Home improvement / remodeling",
  handyman: "Handyman",
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
              : "Repair, installation, renovation",
      };
}
