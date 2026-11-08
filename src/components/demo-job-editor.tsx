"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Stage = "setup" | "docs" | "share" | "payment";
type Line = { id: number; title: string; category: "part" | "labor"; quantity: string; price: string };
const money = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(cents / 100);
const dollarsToCents = (value: string) => Math.max(0, Math.round((Number(value) || 0) * 100));

export function DemoJobEditor({ initialStage = "setup" }: { initialStage?: Stage }) {
  const [stage, setStage] = useState<Stage>(initialStage);
  const [customer, setCustomer] = useState("Alex Example");
  const [asset, setAsset] = useState("2019 Ford F-150");
  const [jobTitle, setJobTitle] = useState("Front brake service");
  const [notes, setNotes] = useState("Customer reports vibration when braking.");
  const [lines, setLines] = useState<Line[]>([
    { id: 1, title: "Front brake pads", category: "part", quantity: "1", price: "235" },
    { id: 2, title: "Front brake rotors", category: "part", quantity: "2", price: "189" },
    { id: 3, title: "Brake labor", category: "labor", quantity: "3", price: "175" },
  ]);
  const [taxRate, setTaxRate] = useState("8.25");
  const [discount, setDiscount] = useState("0");
  const [agreements, setAgreements] = useState(["Work authorization"]);
  const [recipient, setRecipient] = useState("alex@example.test");
  const [message, setMessage] = useState("Please review the estimate and authorize the work.");
  const [showCustomerView, setShowCustomerView] = useState(false);
  const [packetReady, setPacketReady] = useState(false);
  const [nextId, setNextId] = useState(4);

  const totals = useMemo(() => {
    const computed = lines.map((line) => ({
      ...line,
      total: Math.round(Math.max(0, Number(line.quantity) || 0) * dollarsToCents(line.price)),
    }));
    const subtotal = computed.reduce((sum, l) => sum + l.total, 0);
    const parts = computed.filter((l) => l.category === "part").reduce((sum, l) => sum + l.total, 0);
    const tax = Math.round(parts * Math.max(0, Number(taxRate) || 0) / 100);
    const discountCents = dollarsToCents(discount);
    return { computed, subtotal, tax, discountCents, total: Math.max(0, subtotal + tax - discountCents) };
  }, [lines, discount, taxRate]);

  const updateLine = (id: number, field: keyof Line, value: string) => {
    setLines((previous) => previous.map((line) => line.id === id ? { ...line, [field]: value } : line));
    setPacketReady(false);
  };
  const addLine = (category: Line["category"]) => {
    setLines((previous) => [...previous, { id: nextId, title: "", category, quantity: "1", price: "0" }]);
    setNextId((v) => v + 1);
    setPacketReady(false);
  };
  const stages: { value: Stage; label: string }[] = [
    { value: "setup", label: "1. Job Setup" },
    { value: "docs", label: "2. Documents" },
    { value: "share", label: "3. Share" },
    { value: "payment", label: "4. Payment" },
  ];
  return (
    <main id="main-content" className="demo-job-editor" tabIndex={-1}>
      <header className="demo-job-header">
        <div>
          <Link href="/demo/crm?customer=alex">← Customer profile</Link>
          <h1>Job #10042 <span className="demo-job-muted">· {jobTitle || "New job"}</span></h1>
          <p>{customer || "Customer"} · {asset || "Vehicle"}</p>
        </div>
        <div className="demo-job-summary">
          <small>Estimated total</small>
          <strong>{money(totals.total)}</strong>
          <span>Draft · Not sent</span>
        </div>
      </header>
      <div className="demo-job-banner">Interactive demo · Change pricing and preview customer documents. Nothing is sent or charged.</div>
      <nav className="demo-job-tabs" aria-label="Job steps">
        {stages.map((step) => (
          <button key={step.value} type="button" className={stage === step.value ? "active" : ""}
            aria-current={stage === step.value ? "step" : undefined}
            onClick={() => { setStage(step.value); setShowCustomerView(false); }}>
            {step.label}
          </button>
        ))}
      </nav>
      {stage === "setup" && (
        <section className="demo-job-panel" aria-label="Job and pricing setup">
          <div className="demo-job-section-head">
            <div><h2>Job Setup</h2><p>Enter the work once. Customer documents use these prices.</p></div>
          </div>
          <div className="demo-job-field-grid">
            <label>Customer <input value={customer} onChange={(e) => setCustomer(e.target.value)} /></label>
            <label>Vehicle or asset <input value={asset} onChange={(e) => setAsset(e.target.value)} /></label>
            <label>Job name <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></label>
            <label>Work description <input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <div className="demo-job-section-head">
            <div><h3>Parts & labor</h3><p>Edit quantities or prices; totals update instantly.</p></div>
          </div>
          <div className="demo-job-line-head" aria-hidden="true"><span>Item</span><span>Qty</span><span>Unit price</span><span>Amount</span><span></span></div>
          <div className="demo-job-lines">
            {totals.computed.map((line) => (
              <div className="demo-job-line" key={line.id}>
                <label className="demo-job-item">Item <input aria-label={`Item name ${line.id}`} value={line.title}
                  placeholder={line.category === "part" ? "Part" : "Labor"}
                  onChange={(e) => updateLine(line.id, "title", e.target.value)} />
                  <small>{line.category === "part" ? "Part" : "Labor"}</small>
                </label>
                <label>Qty <input aria-label={`Quantity ${line.id}`} inputMode="decimal" type="number" min="0" step="0.5"
                  value={line.quantity} onChange={(e) => updateLine(line.id, "quantity", e.target.value)} /></label>
                <label>Unit price <input aria-label={`Unit price ${line.id}`} inputMode="decimal" type="number" min="0" step="0.01"
                  value={line.price} onChange={(e) => updateLine(line.id, "price", e.target.value)} /></label>
                <strong className="demo-job-line-amount">{money(line.total)}</strong>
                <button type="button" className="demo-job-remove" aria-label={`Remove ${line.title || "item"}`}
                  onClick={() => setLines((prev) => prev.filter((v) => v.id !== line.id))}>×</button>
              </div>
            ))}
          </div>
          <div className="demo-job-row-actions">
            <button className="btn secondary" type="button" onClick={() => addLine("part")}>+ Part</button>
            <button className="btn secondary" type="button" onClick={() => addLine("labor")}>+ Labor</button>
          </div>
          <div className="demo-job-totals">
            <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
            <div><label>Parts tax (%) <input type="number" min="0" max="100" step="0.01" inputMode="decimal"
              value={taxRate} onChange={(e) => setTaxRate(e.target.value)}/></label><strong>{money(totals.tax)}</strong></div>
            <div><label>Discount ($) <input type="number" min="0" step="0.01" inputMode="decimal"
              value={discount} onChange={(e) => setDiscount(e.target.value)}/></label><strong>−{money(totals.discountCents)}</strong></div>
            <div className="demo-job-grand"><span>Estimated total</span><strong>{money(totals.total)}</strong></div>
          </div>
          <div className="demo-job-bottom-actions">
            <button type="button" className="btn primary" onClick={() => setStage("docs")}>Next: Preview Documents →</button>
          </div>
        </section>
      )}
      {stage === "docs" && (
        <section className="demo-job-panel">
          <div className="demo-job-section-head">
            <div><h2>Documents</h2><p>Select an agreement, preview the customer's estimate, then share.</p></div>
            <button className="btn secondary" type="button" onClick={() => setShowCustomerView((v) => !v)}>
              {showCustomerView ? "Close preview" : "Preview customer view"}
            </button>
          </div>
          <div className="demo-job-doc-grid">
            <div className="demo-job-doc-list">
              <div className="demo-job-doc-row"><strong>Estimate v1</strong><span>Ready to share</span><small>Included automatically</small></div>
              {["Work authorization", "Vehicle inspection checklist", "Privacy notice"].map((name) => (
                <label className="demo-job-doc-check" key={name}>
                  <input type="checkbox" checked={agreements.includes(name)} onChange={(e) =>
                    setAgreements((v) => e.target.checked ? [...v, name] : v.filter((x) => x !== name))}/>
                  <span>{name}</span>
                </label>
              ))}
            </div>
            <article className="demo-job-paper">
              <small>SHOP REVENUE · CUSTOMER ESTIMATE</small>
              <h3>{jobTitle}</h3><p>{customer} · {asset}</p>
              <p>{notes}</p>
              {totals.computed.map((line) => <div className="demo-job-paper-line" key={line.id}>
                <span>{line.title || "Unnamed item"} × {line.quantity}</span><strong>{money(line.total)}</strong>
              </div>)}
              <div className="demo-job-paper-line"><span>Tax</span><span>{money(totals.tax)}</span></div>
              <div className="demo-job-paper-line"><span>Discount</span><span>−{money(totals.discountCents)}</span></div>
              <div className="demo-job-paper-line demo-job-paper-total"><strong>Total</strong><strong>{money(totals.total)}</strong></div>
              <p className="demo-job-paper-note">Work and prices are set by the shop. The customer can approve or decline the work, not edit prices.</p>
              {showCustomerView && <div className="demo-job-customer-example">
                <h4>Customer approval preview</h4>
                <p>Customer reviews itemized work, chooses what to authorize, and signs electronically.</p>
                <span className="btn secondary" aria-disabled="true">Signature (preview only)</span>
              </div>}
            </article>
          </div>
          <div className="demo-job-bottom-actions">
            <button type="button" className="btn secondary" onClick={() => setStage("setup")}>← Edit pricing</button>
            <button type="button" className="btn primary" onClick={() => setStage("share")}>Next: Share packet →</button>
          </div>
        </section>
      )}
      {stage === "share" && (
        <section className="demo-job-panel demo-job-share-panel">
          <h2>Share customer packet</h2>
          <p>One customer link, containing the estimate and selected agreements.</p>
          <div className="demo-job-doc-row">
            <strong>Estimate v1 + {agreements.length} agreement{agreements.length === 1 ? "" : "s"}</strong>
            <span>{money(totals.total)}</span>
          </div>
          <label>Customer email<input type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} /></label>
          <label>Message<textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          <div className="demo-job-bottom-actions">
            <button type="button" className="btn secondary" onClick={() => setStage("docs")}>← Documents</button>
            <button type="button" className="btn primary" onClick={() => setPacketReady(true)}>Preview send confirmation</button>
          </div>
          {packetReady && <div className="demo-job-confirm" role="status">
            <strong>Packet ready to share</strong>
            <p>This is a demo preview. No email was sent to {recipient || "the customer"}.</p>
            <p>{agreements.length + 1} documents · {money(totals.total)} · Customer signature required</p>
          </div>}
        </section>
      )}
      {stage === "payment" && (
        <section className="demo-job-panel">
          <h2>Payments</h2>
          <div className="demo-job-totals"><div className="demo-job-grand"><span>Balance due</span><strong>{money(totals.total)}</strong></div></div>
          <p>After the work is authorized and completed, the shop can invoice and collect payment using its connected Stripe account.</p>
          <div className="demo-job-confirm"><strong>Demo only</strong><p>No charge can be taken from this preview.</p></div>
          <button className="btn secondary" type="button" onClick={() => setStage("setup")}>Edit job setup</button>
        </section>
      )}
    </main>
  );
}
