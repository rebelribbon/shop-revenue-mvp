"use client";
import { useActionHydration } from "./action-hydration";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerPicker } from "./customer-picker";
import type { JobOptions } from "./job-editor";
import { createAppointmentAction } from "@/server/actions/appointments";
export function VisitEditor({
  options,
  auto,
  initial,
  source,
}: {
  options: JobOptions;
  auto: boolean;
  initial: {
    customerId?: string;
    vehicleId?: string;
    serviceAssetId?: string;
    day: string;
  };
  source: { sourceRecoveryItemId?: string; sourceContactActivityId?: string };
}) {
  const [customer, setCustomer] = useState(initial.customerId ?? ""),
    [vehicle, setVehicle] = useState(initial.vehicleId ?? ""),
    [asset, setAsset] = useState(initial.serviceAssetId ?? ""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const ready = useActionHydration();
  const router = useRouter();
  return (
    <form
      data-ux-ready={ready}
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        const startsAt = String(f.get("startsAt") ?? "");
        try {
          const r = await createAppointmentAction({
            ...source,
            customerId: customer,
            vehicleId: auto ? vehicle : "",
            serviceAssetId: auto ? "" : asset,
            startsAt,
            reason: String(f.get("reason") ?? ""),
            notes: String(f.get("notes") ?? ""),
            clientRequestId: requestId,
          });
          if (r.ok) {
            setRequestId(crypto.randomUUID());
            router.push(`/app/schedule?week=${startsAt.slice(0, 10)}&booked=1`);
            router.refresh();
          } else setMessage(r.error.message);
        } catch {
          setMessage("Could not book the visit. Your entries are kept.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Visit details</h2>
      <CustomerPicker
        options={options.customers}
        value={customer}
        onChange={(id) => {
          setCustomer(id);
          setVehicle("");
          setAsset("");
        }}
      />
      <label htmlFor="visit-target">
        {auto ? "Vehicle (optional)" : "Property / equipment (optional)"}
      </label>
      <select
        id="visit-target"
        value={auto ? vehicle : asset}
        onChange={(e) => {
          if (auto) setVehicle(e.target.value);
          else setAsset(e.target.value);
        }}
      >
        <option value="">
          {auto ? "No vehicle selected" : "No property / equipment selected"}
        </option>
        {auto
          ? options.vehicles
              .filter((v) => v.customerId === customer)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.year, v.make, v.model].filter(Boolean).join(" ") ||
                    "Vehicle"}
                </option>
              ))
          : options.serviceAssets
              .filter((a) => a.customerId === customer)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
      </select>
      <label htmlFor="startsAt">Date and time</label>
      <input
        id="startsAt"
        name="startsAt"
        type="datetime-local"
        defaultValue={`${initial.day}T09:00`}
        required
      />
      <label htmlFor="reason">Reason</label>
      <input id="reason" name="reason" maxLength={200} />
      <label htmlFor="notes">Notes</label>
      <textarea id="notes" name="notes" maxLength={5000} rows={3} />
      <button className="btn primary" disabled={busy}>
        {busy ? "Booking…" : "Book visit"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
