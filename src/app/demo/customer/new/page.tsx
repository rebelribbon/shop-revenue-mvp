"use client";

import Link from "next/link";
import { useState } from "react";

export default function DemoCreateCustomerPage() {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <main id="main-content" className="demo-customer-form-page">
      <header className="crm-sample-head">
        <Link href="/demo/crm" className="crm-sample-brand">Shop Revenue</Link>
        <span className="muted">Demo customer setup · No login required</span>
      </header>
      <section className="demo-job-panel">
        <Link href="/demo/crm">← Customers</Link>
        {saved ? (
          <div className="demo-job-confirm" role="status">
            <h1>Customer created in this demo</h1>
            <p>{first} {last}</p>
            <p>No account or real customer record was created. You can continue into job pricing to try the next step.</p>
            <Link className="btn primary" href="/demo/job">+ Set up job & pricing</Link>
          </div>
        ) : (
          <>
            <h1>Add customer</h1>
            <p className="muted">The same simple form layout used by the CRM. Everything here is a local demo.</p>
            <form className="demo-customer-form" onSubmit={(e) => { e.preventDefault(); setSaved(true); }}>
              <label>First name <input required autoComplete="off" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
              <label>Last name <input required autoComplete="off" value={last} onChange={(e) => setLast(e.target.value)} /></label>
              <label>Mobile number <input type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
              <label>Email <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <div className="demo-job-bottom-actions">
                <Link className="btn secondary" href="/demo/crm">Cancel</Link>
                <button className="btn primary" type="submit">Save demo customer</button>
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
