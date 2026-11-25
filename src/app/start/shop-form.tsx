"use client";
import { useActionState, useState } from "react";
import { createMyShop } from "@/server/actions/signup";
import { businessTypes, businessTypeLabels, type BusinessType } from "@/lib/business-types";
export function ShopForm() {
  const [state, action, pending] = useActionState(createMyShop, null);
  const [type, setType] = useState<BusinessType | "">("");
  const [step, setStep] = useState(1);
  return (
    <form action={action} className="card">
      <p className="muted">Step {step} of 2 · {step === 1 ? "Business type" : "Business information"}</p>
      <label htmlFor="business-type">What kind of business do you run?</label>
      <select id="business-type" name="businessType" value={type} onChange={(e) => setType(e.target.value as BusinessType)} required>
        <option value="">Choose your business type</option>
        {businessTypes.map((value) => <option key={value} value={value}>{businessTypeLabels[value]}</option>)}
      </select>
      {step === 1 && <button type="button" className="btn primary" disabled={!type} onClick={() => setStep(2)}>Continue</button>}
      <div hidden={step === 1}>
      <label htmlFor="owner-name">Your name</label>
      <input
        id="owner-name"
        name="ownerName"
        autoComplete="name"
        required={step === 2}
        maxLength={100}
      />
      <label htmlFor="new-shop-name">Shop name</label>
      <input
        id="new-shop-name"
        name="shopName"
        autoComplete="organization"
        required
        maxLength={200}
      />
      <button className="btn primary" disabled={pending}>
        {pending ? "Creating shop…" : "Create shop and continue"}
      </button>
      <button type="button" className="btn secondary" onClick={() => setStep(1)}>Back</button>
      </div>
      {state && (
        <p className="notice error" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
