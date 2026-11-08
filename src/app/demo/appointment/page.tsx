"use client";
import { use, useState } from "react";
import Link from "next/link";
import { demoCustomers } from "@/lib/demo-customers";

export default function DemoAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const params = use(searchParams);
  const selected =
    demoCustomers.find((c) => c.id === params.customer) ?? demoCustomers[0];
  const profileUrl = `/demo/crm?customer=${selected.id}`;
  const [customer, setCustomer] = useState(selected.name);
  const [date, setDate] = useState("2026-11-10T09:00");
  const [reason, setReason] = useState("Brake service");
  const [saved, setSaved] = useState(false);
  return (
    <main className="demo-customer-form-page" id="main-content">
      <header className="crm-sample-head">
        <Link className="crm-sample-brand" href="/demo/crm?view=appointments">
          Shop Revenue
        </Link>
        <span className="muted">Appointment preview · Sample only</span>
      </header>
      <section className="demo-job-panel">
        <Link href={profileUrl}>← Customer profile</Link>
        <h1>New appointment</h1>
        {saved ? (
          <div className="demo-job-confirm" role="status">
            <strong>Appointment saved in this demo</strong>
            <p>
              {customer} · {date.replace("T", " ")} · {reason}
            </p>
            <p>Nothing was saved to the live database.</p>
            <Link className="btn primary" href="/demo/crm?view=appointments">
              Appointments
            </Link>
          </div>
        ) : (
          <form
            className="demo-customer-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSaved(true);
            }}
          >
            <label>
              Customer{" "}
              <input
                required
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </label>
            <label>
              Date & time{" "}
              <input
                required
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Reason{" "}
              <input
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="demo-job-bottom-actions">
              <Link className="btn secondary" href={profileUrl}>
                Cancel
              </Link>
              <button className="btn primary" type="submit">
                Save appointment
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
