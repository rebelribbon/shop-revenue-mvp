// Where a customer found the shop. Order is the order shown in pickers.
export const LEAD_SOURCES = [
  ["google", "Google / Maps"],
  ["referral", "Referral"],
  ["booking", "Online booking"],
  ["website", "Our website"],
  ["social", "Facebook / social"],
  ["drive_by", "Drove by / walk-in"],
  ["repeat", "Past customer"],
  ["other", "Other"],
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number][0];
export const LEAD_SOURCE_KEYS = LEAD_SOURCES.map((s) => s[0]) as [
  LeadSource,
  ...LeadSource[],
];
export const leadSourceLabel = (key: string | null | undefined) =>
  LEAD_SOURCES.find((s) => s[0] === key)?.[1] ?? "Not set";
