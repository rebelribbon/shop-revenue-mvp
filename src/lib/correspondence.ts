export const correspondenceChannels = [
  "call",
  "text",
  "email",
  "other",
] as const;
export const correspondenceOutcomes = [
  "sent",
  "received",
  "reached",
  "no_answer",
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
  no_answer: "No answer",
  completed: "Completed",
};

export function outcomesFor(
  channel: CorrespondenceChannel,
): CorrespondenceOutcome[] {
  if (channel === "call") return ["reached", "no_answer", "received"];
  if (channel === "other") return ["completed", "sent", "received"];
  return ["sent", "received"];
}
