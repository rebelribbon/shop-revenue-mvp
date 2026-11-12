"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActionHydration } from "./action-hydration";
import type { JobOptions } from "./job-editor";
import type { JobInput } from "@/domain/jobs";
import { createJobAction } from "@/server/actions/jobs";
import { updateMediaAction } from "@/server/actions/job-media";

// RO intake is deliberately separate from estimate pricing and recurring jobs.
// The database assigns a unique RO identity; staff do not type job names or prices.
export function RoCheckinEditor({
  options,
  initial,
  attachMediaId,
  advisors,
  canManage,
  currentUserId,
}: {
  options: JobOptions;
  advisors: { userId: string; name: string }[];
  canManage: boolean;
  currentUserId: string;
  initial?: Partial<JobInput>;
  attachMediaId?: string;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const customerId = initial?.customerId ?? "";
  const availableVehicles = options.vehicles.filter(
    (vehicle) => vehicle.customerId === customerId,
  );
  const [vehicleId, setVehicleId] = useState(
    initial?.vehicleId ??
      (availableVehicles.length === 1 ? availableVehicles[0].id : ""),
  );
  const [mileageIn, setMileageIn] = useState(
    initial?.mileageIn == null ? "" : String(initial.mileageIn),
  );
  const [concerns, setConcerns] = useState(initial?.concerns ?? "");
  const [advisorUserId, setAdvisorUserId] = useState(canManage ? "" : currentUserId);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const customer = options.customers.find((item) => item.id === customerId);

  if (!customerId || !customer) {
    return (
      <section className="card">
        <h2>Start a repair order from the customer</h2>
        <p>
          Open the customer profile, select the vehicle, and choose New RO. The
          customer will carry into the repair order automatically.
        </p>
        <Link className="btn primary" href="/app/customers">
          Go to customers
        </Link>
      </section>
    );
  }

  return (
    <form
      className="card"
      data-ux-ready={ready}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready || pending || !vehicleId || !advisorUserId) return;
        setPending(true);
        setMessage("");
        try {
          const summary = concerns.trim().split(/\r?\n/)[0]?.slice(0, 100);
          const result = await createJobAction({
            customerId,
            vehicleId,
            title: summary || "Vehicle inspection / service",
            inspectionFirst: true,
            advisorUserId,
            concerns: concerns.trim(),
            mileageIn: mileageIn === "" ? null : Number(mileageIn),
            sourceRecoveryItemId: initial?.sourceRecoveryItemId,
            sourceContactActivityId: initial?.sourceContactActivityId,
            sourceAppointmentId: initial?.sourceAppointmentId,
            repeat: null,
            warrantyMonths: null,
            parts: [],
            labor: [],
            clientRequestId: requestId,
          });
          if (!result.ok) {
            setMessage(result.error.message);
            return;
          }
          const jobId = (result.data as { id: string }).id;
          setRequestId(crypto.randomUUID());
          if (attachMediaId) {
            try {
              await updateMediaAction({
                mediaId: attachMediaId,
                jobId,
                showCustomer: "true",
                clientRequestId: crypto.randomUUID(),
              });
            } catch {
              // The RO was created successfully even if attaching media fails.
            }
          }
          router.push(`/app/jobs?job=${encodeURIComponent(jobId)}&saved=1`);
          router.refresh();
        } catch {
          setMessage(
            "Could not create the RO. Your check-in details are still here.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset className="hydration-fields" disabled={!ready || pending}>
        <h2>New repair order</h2>
        <p className="muted">
          The RO number is assigned automatically when you save. Estimate
          pricing comes after the inspection.
        </p>
        <div className="ro-check-in">
          <strong>Customer</strong>
          <p>{customer.name}</p>
        </div>
        <label htmlFor="ro-intake-vehicle">Vehicle</label>
        <select
          id="ro-intake-vehicle"
          required
          value={vehicleId}
          onChange={(event) => setVehicleId(event.target.value)}
        >
          <option value="">Select vehicle</option>
          {availableVehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {[vehicle.year, vehicle.make, vehicle.model]
                .filter(Boolean)
                .join(" ") || "Vehicle"}
            </option>
          ))}
        </select>
        <p>
          <Link href={`/app/customers/${customerId}?view=assets`}>
            Add another vehicle / scan VIN
          </Link>
        </p>
        {canManage ? (
          <>
            <label htmlFor="ro-intake-advisor">Assigned service advisor</label>
            <select
              id="ro-intake-advisor"
              required
              value={advisorUserId}
              onChange={(event) => setAdvisorUserId(event.target.value)}
            >
              <option value="">Choose an advisor</option>
              {advisors.map((advisor) => (
                <option key={advisor.userId} value={advisor.userId}>
                  {advisor.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p className="muted">Assigned service advisor: You</p>
        )}
        <label htmlFor="ro-intake-mileage">Mileage at check-in</label>
        <input
          id="ro-intake-mileage"
          inputMode="numeric"
          autoComplete="off"
          maxLength={7}
          value={mileageIn}
          onChange={(event) =>
            setMileageIn(event.target.value.replace(/\D/g, ""))
          }
        />
        <label htmlFor="ro-intake-concerns">
          Customer concerns / reason for visit
        </label>
        <textarea
          id="ro-intake-concerns"
          rows={4}
          maxLength={2000}
          value={concerns}
          placeholder="Describe the customer's request in their own words."
          onChange={(event) => setConcerns(event.target.value)}
        />
        {message && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
        <button
          className="btn primary"
          type="submit"
          disabled={!ready || pending || !vehicleId || !advisorUserId}
        >
          {pending ? "Creating RO…" : "Create RO"}
        </button>
      </fieldset>
    </form>
  );
}
