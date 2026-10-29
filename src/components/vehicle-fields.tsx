"use client";
import { useState, useTransition } from "react";
import { lookupVinAction } from "@/server/actions/vin";

type Initial = {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  vin?: string | null;
  plate?: string | null;
  mileage?: number | null;
  notes?: string | null;
};

export function VehicleFields({ initial = {} }: { initial?: Initial }) {
  const [vin, setVin] = useState(initial.vin ?? "");
  const [year, setYear] = useState(initial.year?.toString() ?? "");
  const [make, setMake] = useState(initial.make ?? "");
  const [model, setModel] = useState(initial.model ?? "");
  const [trim, setTrim] = useState(initial.trim ?? "");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function lookup() {
    startTransition(async () => {
      const result = await lookupVinAction(vin);
      if (!result.ok) return setMessage(result.message);
      if (result.data.year) setYear(String(result.data.year));
      if (result.data.make) setMake(result.data.make);
      if (result.data.model) setModel(result.data.model);
      if (result.data.trim) setTrim(result.data.trim);
      setMessage("VIN decoded. Review the vehicle details before saving.");
    });
  }

  return (
    <>
      <label htmlFor="vin">VIN</label>
      <div className="inline-action">
        <input id="vin" name="vin" maxLength={17} autoCapitalize="characters" value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} />
        <button className="btn secondary" type="button" onClick={lookup} disabled={pending || vin.replace(/\s/g, "").length !== 17}>{pending ? "Looking up…" : "Look up VIN"}</button>
      </div>
      {message && <p className="muted" role="status">{message}</p>}
      <label htmlFor="year">Year</label><input id="year" name="year" type="number" min={1886} max={2200} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
      <label htmlFor="make">Make</label><input id="make" name="make" maxLength={100} value={make} onChange={(e) => setMake(e.target.value)} />
      <label htmlFor="model">Model</label><input id="model" name="model" maxLength={100} value={model} onChange={(e) => setModel(e.target.value)} />
      <label htmlFor="trim">Trim</label><input id="trim" name="trim" maxLength={100} value={trim} onChange={(e) => setTrim(e.target.value)} />
      <label htmlFor="plate">Plate</label><input id="plate" name="plate" maxLength={20} autoCapitalize="characters" defaultValue={initial.plate ?? ""} />
      <label htmlFor="mileage">Mileage</label><input id="mileage" name="mileage" type="number" min={0} max={3000000} inputMode="numeric" defaultValue={initial.mileage ?? ""} />
      <label htmlFor="vehicleNotes">Notes</label><textarea id="vehicleNotes" name="notes" rows={4} maxLength={5000} defaultValue={initial.notes ?? ""} />
    </>
  );
}
