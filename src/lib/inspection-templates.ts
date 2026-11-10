// The checklist a tech walks through, by line of business. Plain names a
// customer understands; each item gets Good / Watch / Needs work.
import { isAutomotive } from "./business-types";
import { inspectionPoints } from "./vehicle-inspection";

export type InspectionStatus = "good" | "watch" | "fix" | "na" | "unchecked";
export type InspectionAssessment = {
  diagnosis: string;
  bay: string;
  vehiclePickedUp: boolean;
  pickedUpAt: string | null;
};
export type InspectionItem = {
  key: string;
  label: string;
  status: InspectionStatus;
  note: string;
  recommendedWork?: string;
  section?: string;
  hint?: string;
  measurements?: Partial<Record<"lf" | "rf" | "lr" | "rr" | "spare", string>>;
  // Hours to quote if it becomes estimate work (hundredths).
  hoursHundredths: number;
  addedToJob: boolean;
};

const AUTO = inspectionPoints.map(
  (item) => [item.id, item.label, 100] as const,
);

const HVAC = [
  ["filter", "Air filter", 25],
  ["coils", "Evaporator & condenser coils", 100],
  ["refrigerant", "Refrigerant level", 100],
  ["electrical", "Electrical & capacitors", 100],
  ["drain", "Condensate drain", 50],
  ["thermostat", "Thermostat", 50],
  ["ducts", "Ductwork & vents", 150],
  ["burner", "Burner / heat exchanger", 150],
] as const;

const HOME = [
  ["exterior", "Exterior & roofline", 100],
  ["plumbing", "Visible plumbing & leaks", 100],
  ["electrical", "Outlets, switches & panel", 100],
  ["doors", "Doors & windows", 100],
  ["safety", "Smoke & CO detectors", 25],
  ["damage", "Damage found on site", 100],
] as const;

export function inspectionTemplate(businessType: string): InspectionItem[] {
  const list = isAutomotive(businessType)
    ? AUTO
    : businessType === "hvac"
      ? HVAC
      : HOME;
  return list.map(([key, label, hours]) => ({
    key,
    label,
    ...(isAutomotive(businessType)
      ? (() => {
          const point = inspectionPoints.find((p) => p.id === key);
          return point ? { section: point.section, hint: point.hint } : {};
        })()
      : {}),
    status: "unchecked",
    note: "",
    recommendedWork: "",
    hoursHundredths: hours,
    addedToJob: false,
  }));
}

export const STATUS_LABELS: Record<InspectionStatus, string> = {
  good: "Satisfactory",
  watch: "Service Soon",
  fix: "Service Now",
  na: "N/A",
  unchecked: "Not checked",
};
