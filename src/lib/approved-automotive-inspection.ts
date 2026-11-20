// The eight-step, 40-point checklist from the user-approved Automotive UI.
// Kept separate from the legacy vehicle inspection so historical records and
// existing customer documents are never silently relabeled.
export const approvedAutomotiveGroups = [
  {
    name: "Safety & visibility",
    subtitle: "Driver safety and roadworthiness",
    items: [
      "Dash warning lights",
      "Exterior headlamps",
      "Brake / signal lights",
      "Windshield and glass",
      "Horn and wiper operation",
    ],
  },
  {
    name: "Tires & wheels",
    subtitle: "Measure, note, and photograph tire concerns",
    items: [
      "Left front tire tread",
      "Right front tire tread",
      "Left rear tire tread",
      "Right rear tire tread",
      "Tire pressures and wheels",
    ],
  },
  {
    name: "Braking system",
    subtitle: "Component condition and performance",
    items: [
      "Front brake pads",
      "Rear brake pads",
      "Brake rotors and drums",
      "Brake hoses and lines",
      "Brake pedal / parking brake",
    ],
  },
  {
    name: "Engine & cooling",
    subtitle: "Fluids, leaks, and engine health",
    items: [
      "Engine oil level / condition",
      "Coolant level / condition",
      "Engine air filter",
      "Drive belts and hoses",
      "Engine leaks or abnormal noise",
    ],
  },
  {
    name: "Electrical & HVAC",
    subtitle: "Starting, charging, diagnostics, comfort",
    items: [
      "Battery condition / load test",
      "Charging system output",
      "Starter operation",
      "Fault code scan",
      "Air conditioning and heating",
    ],
  },
  {
    name: "Steering & suspension",
    subtitle: "Handling and chassis integrity",
    items: [
      "Tie rod ends and linkage",
      "Ball joints / bushings",
      "Shocks and struts",
      "CV joints and axle boots",
      "Suspension / wheel bearing noise",
    ],
  },
  {
    name: "Undercarriage & fluids",
    subtitle: "Inspect below vehicle",
    items: [
      "Transmission fluid / leaks",
      "Brake fluid condition",
      "Power steering / EPS",
      "Exhaust system condition",
      "Fuel lines / fluid leaks",
    ],
  },
  {
    name: "Road test & final checks",
    subtitle: "Reproduce the concern and verify operation",
    items: [
      "Acceleration / idle quality",
      "Braking under load",
      "Steering and alignment feel",
      "Gear shifts / driveline",
      "Vibration, rattles and road noise",
    ],
  },
] as const;

export const approvedAutomotivePoints = approvedAutomotiveGroups.flatMap(
  (group, gi) =>
    group.items.map((label, ii) => ({
      key: `${gi}-${ii}`,
      label,
      section: group.name,
      hint: group.subtitle,
    })),
);
