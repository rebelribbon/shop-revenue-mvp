import type { MediaTag } from "@/db/schema/job-media";

export const TAG_LABELS: Record<MediaTag, string> = {
  before: "Before",
  after: "After",
  issue: "Found an issue",
  quote: "For the quote",
  other: "Other",
};
