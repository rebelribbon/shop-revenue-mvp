import { describe, expect, it } from "vitest";
import { addLocalDays, localDateKey, localDateTimeToUtc, localMidnightToUtc } from "@/lib/timezone";

describe("M2 business timezone helpers", () => {
  it("converts a Chicago local appointment time to the correct UTC instant", () => {
    expect(localDateTimeToUtc("2026-10-25T10:30", "America/Chicago").toISOString()).toBe("2026-10-25T15:30:00.000Z");
  });

  it("handles the daylight-saving spring boundary", () => {
    expect(localDateTimeToUtc("2026-03-09T10:30", "America/Chicago").toISOString()).toBe("2026-03-09T15:30:00.000Z");
  });

  it("builds local Today/Tomorrow boundaries without using the server timezone", () => {
    const instant = new Date("2026-10-26T03:00:00.000Z");
    expect(localDateKey(instant, "America/Chicago")).toBe("2026-10-25");
    expect(addLocalDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(localMidnightToUtc("2026-10-25", "America/Chicago").toISOString()).toBe("2026-10-25T05:00:00.000Z");
  });
});
