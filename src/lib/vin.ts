// VINs never use I, O or Q. Door-jamb barcodes (Code 39) often add a
// leading "I" (imported) or other text, so find the 17-character run,
// preferring one whose check digit (position 9) is right.
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const VALUES: Record<string, number> = Object.fromEntries(
  [..."ABCDEFGH"]
    .map((c, i) => [c, i + 1])
    .concat(
      [..."JKLMN"].map((c, i) => [c, i + 1]),
      [
        ["P", 7],
        ["R", 9],
      ],
      [..."STUVWXYZ"].map((c, i) => [c, i + 2]),
      [..."0123456789"].map((c) => [c, Number(c)]),
    ),
);
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function vinCheckDigitOk(vin: string) {
  const sum = [...vin].reduce((t, c, i) => t + VALUES[c] * WEIGHTS[i], 0);
  const r = sum % 11;
  return vin[8] === (r === 10 ? "X" : String(r));
}

export function extractVin(raw: string): string | null {
  const text = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const windows: string[] = [];
  for (let i = 0; i + 17 <= text.length; i++) {
    const w = text.slice(i, i + 17);
    if (VIN.test(w)) windows.push(w);
  }
  if (!windows.length) return null;
  // Checked VINs first (North America); otherwise the last run, since
  // prefixes come before the VIN.
  return windows.find(vinCheckDigitOk) ?? windows[windows.length - 1];
}
