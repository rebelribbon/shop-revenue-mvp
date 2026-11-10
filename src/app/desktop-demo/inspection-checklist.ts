/** Editable 40-point template adapted from a user-supplied checklist.
 * Vehicle-specific equipment may be marked N/A by the technician.
 */
export type InspectionResult =
  "satisfactory" | "service_soon" | "service_now" | "na";
export type InspectionItem = {
  result?: InspectionResult;
  notes: string;
  recommendedWork: string;
};
export const inspectionPoints = [
  {
    id: "windshield",
    label: "Windshield",
    section: "Visibility",
    hint: "Cracks · pitting · impact damage",
  },
  {
    id: "wipers",
    label: "Wiper blades",
    section: "Visibility",
    hint: "Left · right · rear",
  },
  {
    id: "defroster",
    label: "Defroster",
    section: "Visibility",
    hint: "Front · rear",
  },
  {
    id: "mirrors",
    label: "Mirrors",
    section: "Visibility",
    hint: "Left · right · interior",
  },
  {
    id: "headlights",
    label: "Headlights",
    section: "Lights",
    hint: "Left · right · low beam · high beam",
  },
  {
    id: "park_lights",
    label: "Park / tail lights",
    section: "Lights",
    hint: "Front left · front right · rear left · rear right",
  },
  {
    id: "brake_lights",
    label: "Brake lights",
    section: "Lights",
    hint: "Left · right · center",
  },
  {
    id: "backup_lights",
    label: "Backup lights",
    section: "Lights",
    hint: "Left · right",
  },
  {
    id: "turn_signals",
    label: "Turn signals",
    section: "Lights",
    hint: "Front left · front right · rear left · rear right",
  },
  {
    id: "side_markers",
    label: "Side marker lights",
    section: "Lights",
    hint: "Front left · front right · rear left · rear right",
  },
  {
    id: "license_plate_lights",
    label: "License plate lights",
    section: "Lights",
    hint: "",
  },
  {
    id: "horn",
    label: "Horn",
    section: "Warning systems",
    hint: "",
  },
  {
    id: "emergency_flashers",
    label: "Emergency flashers",
    section: "Warning systems",
    hint: "Front left · front right · rear left · rear right",
  },
  {
    id: "engine_oil",
    label: "Engine oil",
    section: "Lubricants & fluids",
    hint: "Level · condition · leaks",
  },
  {
    id: "transmission_fluid",
    label: "Transmission fluid",
    section: "Lubricants & fluids",
    hint: "Level · condition · leaks",
  },
  {
    id: "power_steering_fluid",
    label: "Power steering fluid",
    section: "Lubricants & fluids",
    hint: "Level · condition · leaks",
  },
  {
    id: "brake_fluid",
    label: "Brake fluid",
    section: "Lubricants & fluids",
    hint: "Level · condition · leaks",
  },
  {
    id: "clutch_fluid",
    label: "Clutch fluid",
    section: "Lubricants & fluids",
    hint: "Level · condition · leaks",
  },
  {
    id: "washer_fluid",
    label: "Windshield washer fluid",
    section: "Lubricants & fluids",
    hint: "Level · condition · leaks",
  },
  {
    id: "engine_coolant",
    label: "Engine coolant",
    section: "Lubricants & fluids",
    hint: "Level · condition · leaks · coolant protection",
  },
  {
    id: "battery_hold_down",
    label: "Battery carrier / hold-down",
    section: "Battery",
    hint: "Missing · loose · corrosion",
  },
  {
    id: "battery_cables",
    label: "Battery cables / terminals",
    section: "Battery",
    hint: "Missing · loose · corrosion",
  },
  {
    id: "battery_indicator",
    label: "Battery charge indicator / test",
    section: "Battery",
    hint: "Test result · charge condition",
  },
  {
    id: "serpentine_belt",
    label: "Serpentine belt",
    section: "Belts",
    hint: "Wear · idler · tensioner",
  },
  {
    id: "alternator_belt",
    label: "Alternator belt",
    section: "Belts",
    hint: "Wear · tension · pulley",
  },
  {
    id: "ac_belt",
    label: "Air-conditioning belt",
    section: "Belts",
    hint: "Wear · tension · pulley",
  },
  {
    id: "power_steering_belt",
    label: "Power steering belt",
    section: "Belts",
    hint: "Wear · tension · pulley",
  },
  {
    id: "water_pump_belt",
    label: "Water-pump belt",
    section: "Belts",
    hint: "Wear · tension · leaks",
  },
  {
    id: "air_pump_belt",
    label: "Air-pump belt",
    section: "Belts",
    hint: "Wear · tension · pulley",
  },
  {
    id: "radiator_hoses",
    label: "Radiator hoses",
    section: "Hoses",
    hint: "Upper · lower · leaks",
  },
  {
    id: "heater_hoses",
    label: "Heater hoses",
    section: "Hoses",
    hint: "Inlet · outlet · leaks",
  },
  {
    id: "bypass_hoses",
    label: "Bypass / other hoses",
    section: "Hoses",
    hint: "Condition · leaks",
  },
  {
    id: "power_steering_hoses",
    label: "Power steering hoses",
    section: "Hoses",
    hint: "Low pressure · high pressure · leaks",
  },
  {
    id: "transmission_cooler_hoses",
    label: "Transmission cooler hoses",
    section: "Hoses",
    hint: "Inlet · outlet · leaks",
  },
  {
    id: "vacuum_hoses",
    label: "Vacuum hoses",
    section: "Hoses",
    hint: "Condition · leaks",
  },
  {
    id: "fuel_hoses",
    label: "Fuel hoses (underhood only)",
    section: "Hoses",
    hint: "Condition · leaks",
  },
  {
    id: "air_filter",
    label: "Engine air filter",
    section: "Other underhood",
    hint: "Dirty · missing · damaged",
  },
  {
    id: "radiator_fans",
    label: "Radiator cooling fans",
    section: "Other underhood",
    hint: "Mechanical · electric",
  },
  {
    id: "tire_pressure",
    label: "Tire pressure (psi)",
    section: "Tires",
    hint: "LF · RF · LR · RR · spare; record measurements in notes",
  },
  {
    id: "tire_tread",
    label: "Tire tread depth (32nds)",
    section: "Tires",
    hint: "LF · RF · LR · RR · spare; record measurements in notes",
  },
] as const;
export type InspectionPointId = (typeof inspectionPoints)[number]["id"];
export type InspectionResults = Partial<
  Record<InspectionPointId, InspectionItem>
>;
export const inspectionLabels: Record<InspectionResult, string> = {
  satisfactory: "Satisfactory",
  service_soon: "Service Soon",
  service_now: "Service Now",
  na: "N/A",
};
export function inspectReady(results: InspectionResults) {
  return inspectionPoints.every(({ id }) => {
    const item = results[id];
    if (!item?.result) return false;
    if (item.result === "service_soon" && !item.notes.trim()) return false;
    if (
      item.result === "service_now" &&
      (!item.notes.trim() || !item.recommendedWork.trim())
    )
      return false;
    return true;
  });
}
export function inspectionRecommendations(results: InspectionResults) {
  return inspectionPoints.flatMap(({ id, label }) => {
    const item = results[id];
    return (item?.result === "service_soon" ||
      item?.result === "service_now") &&
      item.recommendedWork.trim()
      ? [
          {
            id,
            inspectionArea: label,
            name: item.recommendedWork.trim(),
            notes: item.notes.trim(),
            priority: item.result,
          },
        ]
      : [];
  });
}
