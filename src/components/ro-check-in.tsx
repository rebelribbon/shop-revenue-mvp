"use client";
// Vehicle check-in, the first screen of an RO: who, which vehicle (scan the
// VIN for a new one), miles in, what the customer says is wrong, and which
// technician gets it. Nothing about parts, labor or price yet.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { checkInAction } from "@/server/actions/check-in";
import { createVehicleAction } from "@/server/actions/customers";
import { lookupVinAction } from "@/server/actions/vin";
import { CustomerPicker, type CustomerChoice } from "./customer-picker";
import { VinScanner } from "./vin-scanner";

type VehicleChoice = {
  id: string;
  customerId: string;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
};
const vehicleName = (v: Omit<VehicleChoice, "id" | "customerId">) =>
  [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle";

export function RoCheckIn({
  customers,
  vehicles,
  techs,
  initial,
  fullSheetHref,
}: {
  customers: CustomerChoice[];
  vehicles: VehicleChoice[];
  techs: { userId: string; name: string }[];
  initial: {
    customerId?: string;
    vehicleId?: string;
    sourceRecoveryItemId?: string;
    sourceContactActivityId?: string;
    sourceAppointmentId?: string;
  };
  fullSheetHref: string;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(initial.customerId ?? "");
  const [added, setAdded] = useState<VehicleChoice[]>([]);
  const own = [...vehicles, ...added].filter(
    (v) => v.customerId === customerId,
  );
  const [picked, setPicked] = useState(initial.vehicleId ?? "");
  // One vehicle on file: it's the one. None: go straight to adding it.
  const vehicleId = own.some((v) => v.id === picked)
    ? picked
    : own.length === 1
      ? own[0].id
      : "";
  const [adding, setAdding] = useState(false);
  const showAdd = !!customerId && (adding || own.length === 0);
  const [vin, setVin] = useState(""),
    [year, setYear] = useState(""),
    [make, setMake] = useState(""),
    [model, setModel] = useState(""),
    [plate, setPlate] = useState(""),
    [vinNote, setVinNote] = useState(""),
    [vinBusy, setVinBusy] = useState(false);
  const [miles, setMiles] = useState(""),
    [concerns, setConcerns] = useState(""),
    [tech, setTech] = useState(""),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());

  async function decode(value: string) {
    setVinBusy(true);
    try {
      const r = await lookupVinAction(value);
      if (!r.ok) return setVinNote(r.message);
      if (r.data.year) setYear(String(r.data.year));
      if (r.data.make) setMake(r.data.make);
      if (r.data.model) setModel(r.data.model);
      setVinNote("VIN decoded. Check the details, then add the vehicle.");
    } finally {
      setVinBusy(false);
    }
  }
  async function addVehicle() {
    if (!vin.trim() && !make.trim() && !model.trim())
      return setVinNote("Scan or type the VIN, or enter the make and model.");
    setVinBusy(true);
    try {
      const r = await createVehicleAction({
        customerId,
        vin: vin.replace(/\s/g, ""),
        year,
        make,
        model,
        plate,
        clientRequestId: crypto.randomUUID(),
      });
      if (!r.ok) return setVinNote(r.error.message);
      const id = (r.data as { id: string }).id;
      setAdded((a) => [
        ...a,
        {
          id,
          customerId,
          year: year ? Number(year) : null,
          make: make || null,
          model: model || null,
          plate: plate || null,
        },
      ]);
      setPicked(id);
      setAdding(false);
      setVin("");
      setYear("");
      setMake("");
      setModel("");
      setPlate("");
      setVinNote("");
    } catch {
      setVinNote("Unable to add the vehicle. Try again.");
    } finally {
      setVinBusy(false);
    }
  }

  const ready = !!customerId && !!vehicleId && !!concerns.trim();
  return (
    <form
      className="card form ro-check-in-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready || pending) return;
        setPending(true);
        setMessage("");
        try {
          const r = await checkInAction({
            customerId,
            vehicleId,
            mileageIn: miles === "" ? null : Number(miles),
            concerns,
            technicianUserId: tech || null,
            sourceRecoveryItemId: initial.sourceRecoveryItemId,
            sourceContactActivityId: initial.sourceContactActivityId,
            sourceAppointmentId: initial.sourceAppointmentId,
            clientRequestId: requestId,
          });
          if (r.ok) {
            setRequestId(crypto.randomUUID());
            router.push(
              `/app/jobs?job=${encodeURIComponent((r.data as { id: string }).id)}&saved=checkin`,
            );
            router.refresh();
          } else setMessage(r.error.message);
        } catch {
          setMessage("Unable to save. Your entries were kept.");
        } finally {
          setPending(false);
        }
      }}
    >
      <h2>Customer</h2>
      <CustomerPicker
        options={customers}
        value={customerId}
        onChange={(id) => {
          setCustomerId(id);
          setPicked("");
          setAdding(false);
        }}
        fixed={!!initial.customerId}
      />

      <h2>Vehicle</h2>
      {!customerId ? (
        <p className="muted">Choose the customer first.</p>
      ) : (
        <>
          {own.length > 0 && (
            <>
              <label htmlFor="check-in-vehicle">Vehicle</label>
              <select
                id="check-in-vehicle"
                value={vehicleId}
                required
                onChange={(e) => setPicked(e.target.value)}
              >
                <option value="">Choose vehicle</option>
                {own.map((v) => (
                  <option key={v.id} value={v.id}>
                    {vehicleName(v)}
                    {v.plate ? ` · ${v.plate}` : ""}
                  </option>
                ))}
              </select>
            </>
          )}
          {own.length > 0 && !adding && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setAdding(true)}
            >
              Different vehicle? Scan the VIN
            </button>
          )}
          {showAdd && (
            <fieldset className="check-in-vehicle">
              <legend>
                {own.length ? "Add a vehicle" : "Add this customer’s vehicle"}
              </legend>
              <VinScanner
                onVin={(v) => {
                  setVin(v);
                  void decode(v);
                }}
              />
              <label htmlFor="check-in-vin">VIN</label>
              <div className="inline-action">
                <input
                  id="check-in-vin"
                  maxLength={17}
                  autoCapitalize="characters"
                  autoComplete="off"
                  value={vin}
                  onChange={(e) => setVin(e.target.value.toUpperCase())}
                />
                <button
                  type="button"
                  className="btn secondary"
                  disabled={vinBusy || vin.replace(/\s/g, "").length !== 17}
                  onClick={() => decode(vin)}
                >
                  {vinBusy ? "Looking up…" : "Look up VIN"}
                </button>
              </div>
              <div className="check-in-ymm">
                <label>
                  Year
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={year}
                    onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
                  />
                </label>
                <label>
                  Make
                  <input
                    maxLength={100}
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                  />
                </label>
                <label>
                  Model
                  <input
                    maxLength={100}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Plate (optional)
                <input
                  maxLength={20}
                  autoCapitalize="characters"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                />
              </label>
              {vinNote && (
                <p className="muted" role="status">
                  {vinNote}
                </p>
              )}
              <div className="check-in-vehicle-actions">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={vinBusy}
                  onClick={addVehicle}
                >
                  Add vehicle
                </button>
                {own.length > 0 && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setAdding(false)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </fieldset>
          )}
          <label>
            Miles in
            <input
              inputMode="numeric"
              autoComplete="off"
              maxLength={7}
              value={miles}
              placeholder="84250"
              onChange={(e) => setMiles(e.target.value.replace(/\D/g, ""))}
            />
          </label>
        </>
      )}

      <h2>Customer concerns</h2>
      <label htmlFor="check-in-concerns">
        What the customer says, in their words
      </label>
      <textarea
        id="check-in-concerns"
        rows={4}
        maxLength={2000}
        required
        value={concerns}
        placeholder="Grinding noise from the front when braking. Check engine light on since Monday."
        onChange={(e) => setConcerns(e.target.value)}
      />

      <h2>Technician</h2>
      {techs.length ? (
        <>
          <label htmlFor="check-in-tech">Assign technician</label>
          <select
            id="check-in-tech"
            value={tech}
            onChange={(e) => setTech(e.target.value)}
          >
            <option value="">Assign later</option>
            {techs.map((t) => (
              <option key={t.userId} value={t.userId}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className="muted">
          No technicians on the team yet.{" "}
          <Link href="/app/settings/team">Invite one in Team settings</Link>, or
          check the vehicle in and assign later.
        </p>
      )}
      <p className="muted">
        The technician is notified, diagnoses the vehicle and does the
        inspection. You build the estimate after that.
      </p>
      {message && <p role="alert">{message}</p>}
      {!ready && (
        <p className="muted">
          Needs a customer, a vehicle and the customer’s concerns.
        </p>
      )}
      <button className="btn primary" disabled={!ready || pending}>
        {pending
          ? "Checking in…"
          : tech
            ? "Check in and assign"
            : "Check in vehicle"}
      </button>
      <p>
        <Link href={fullSheetHref}>Build the full job sheet instead</Link>
        <span className="muted"> · for a quick job you can price now</span>
      </p>
    </form>
  );
}
