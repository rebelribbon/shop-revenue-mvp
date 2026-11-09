export const correspondenceChannels = [
  "call",
  "text",
  "email",
  "other",
] as const;
export const callTaskOutcomes = [
  "reached",
  "left_message",
  "no_answer",
] as const;
export type CallTaskOutcome = (typeof callTaskOutcomes)[number];
export const correspondenceOutcomes = [
  "sent",
  "received",
  ...callTaskOutcomes,
  "completed",
] as const;
export type CorrespondenceChannel = (typeof correspondenceChannels)[number];
export type CorrespondenceOutcome = (typeof correspondenceOutcomes)[number];
export type CorrespondenceTarget = {
  customerId: string;
  jobId?: string;
  documentId?: string;
  documentKind?: "estimate" | "invoice";
};
export type SentSummary = { text: string; prefill?: boolean };

export const channelLabels: Record<CorrespondenceChannel, string> = {
  call: "Call",
  text: "Text",
  email: "Email",
  other: "Other correspondence",
};

export const outcomeLabels: Record<CorrespondenceOutcome, string> = {
  sent: "Sent",
  received: "Received",
  reached: "Reached customer",
  left_message: "Left message",
  no_answer: "No answer",
  completed: "Completed",
};

export function outcomesFor(
  channel: CorrespondenceChannel,
): CorrespondenceOutcome[] {
  if (channel === "call") return [...callTaskOutcomes, "received"];
  if (channel === "other") return ["completed", "sent", "received"];
  return ["sent", "received"];
}

export function requiresSummary(outcome: CorrespondenceOutcome) {
  return outcome !== "no_answer" && outcome !== "left_message";
}
