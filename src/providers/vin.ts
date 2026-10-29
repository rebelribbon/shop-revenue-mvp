import "server-only";
import { AppError } from "@/lib/errors";

export type VinDecode = { year: number | null; make: string | null; model: string | null; trim: string | null };

export async function decodeVin(vinInput: string): Promise<VinDecode> {
  const vin = vinInput.replace(/\s/g, "").toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new AppError("VALIDATION", "Enter a valid 17-character VIN.");
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
  } catch {
    throw new AppError("PROVIDER_UNAVAILABLE", "VIN lookup is unavailable right now. You can enter the vehicle manually.");
  }
  if (!response.ok) throw new AppError("PROVIDER_UNAVAILABLE", "VIN lookup is unavailable right now. You can enter the vehicle manually.");
  const body = await response.json() as { Results?: Array<Record<string, string>> };
  const r = body.Results?.[0];
  if (!r) throw new AppError("PROVIDER_UNAVAILABLE", "VIN lookup did not return a vehicle. You can enter it manually.");
  const fatal = String(r.ErrorCode || "0").split(",").some((code) => !["0", "1", "10", "14"].includes(code.trim()));
  if (fatal && !r.Make && !r.Model) throw new AppError("VALIDATION", r.ErrorText || "That VIN could not be decoded.");
  const parsedYear = Number(r.ModelYear);
  return {
    year: Number.isInteger(parsedYear) && parsedYear > 1800 ? parsedYear : null,
    make: r.Make || null,
    model: r.Model || null,
    trim: r.Trim || r.Series || null,
  };
}
