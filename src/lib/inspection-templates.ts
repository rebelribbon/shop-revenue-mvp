// The checklist a tech walks through, by line of business. Plain names a
// customer understands; each item gets Good / Watch / Needs work.
import { isAutomotive } from "./business-types";

export type InspectionStatus = "good" | "watch" | "fix" | "unchecked";
export type InspectionItem = {
  key: string;
  label: string;
  status: InspectionStatus;
  note: string;
  // Hours to quote if it becomes estimate work (hundredths).
  hoursHundredths: number;
  addedToJob: boolean;
};

const AUTO = [
  ["tires", "Tires & tread", 50],
  ["brakes-front", "Front brakes", 150],
  ["brakes-rear", "Rear brakes", 150],
  ["oil", "Engine oil", 50],
  ["fluids", "Coolant, brake & transmission fluid", 50],
  ["battery", "Battery & cables", 50],
  ["lights", "Lights & signals", 50],
  ["wipers", "Wiper blades", 25],
  ["belts", "Belts & hoses", 100],
  ["suspension", "Steering & suspension", 200],
  ["exhaust", "Exhaust", 100],
  ["filters", "Air & cabin filters", 25],
] as const;

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
    status: "unchecked",
    note: "",
    hoursHundredths: hours,
    addedToJob: false,
  }));
}

export const STATUS_LABELS: Record<InspectionStatus, string> = {
  good: "Good",
  watch: "Watch",
  fix: "Needs work",
  unchecked: "Not checked",
};
