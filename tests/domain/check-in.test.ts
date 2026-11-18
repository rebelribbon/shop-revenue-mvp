import { describe, expect, it } from "vitest";
import { checkInTitle } from "@/lib/check-in";

describe("check-in RO name", () => {
  it("uses the customer's first concern, shortened", () => {
    expect(
      checkInTitle("Grinding noise when braking. Also the AC is weak."),
    ).toBe("Grinding noise when braking");
    expect(checkInTitle("Oil change\nRotate tires")).toBe("Oil change");
    expect(checkInTitle("   ")).toBe("Check-in");
    const long = checkInTitle("x".repeat(300));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
  });
});
