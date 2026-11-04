import { describe, expect, it } from "vitest";
import { extractVin } from "@/lib/vin";

describe("VIN from a barcode", () => {
  it("reads a plain VIN", () => {
    expect(extractVin("1HGCM82633A004352")).toBe("1HGCM82633A004352");
  });
  it("drops the leading I on imported-vehicle door-jamb barcodes", () => {
    expect(extractVin("IJHMCM56557C404453")).toBe("JHMCM56557C404453");
  });
  it("finds it inside other text and ignores spacing and case", () => {
    expect(extractVin("vin: 1hgcm8263 3a004352 ")).toBe("1HGCM82633A004352");
  });
  it("checks the check digit", async () => {
    const { vinCheckDigitOk } = await import("@/lib/vin");
    expect(vinCheckDigitOk("1HGCM82633A004352")).toBe(true);
    expect(vinCheckDigitOk("1HGCM82643A004352")).toBe(false);
  });
  it("rejects codes that can't be a VIN", () => {
    expect(extractVin("HELLO")).toBeNull();
    expect(extractVin("1HGCM82633A00435")).toBeNull(); // 16 chars
  });
});
