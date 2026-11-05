"use client";
import { useActionState } from "react";
import { createMyShop } from "@/server/actions/signup";
export function ShopForm() {
  const [state, action, pending] = useActionState(createMyShop, null);
  return (
    <form action={action} className="card">
      <label htmlFor="owner-name">Your name</label>
      <input
        id="owner-name"
        name="ownerName"
        autoComplete="name"
        required
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
        {pending ? "Creating shop…" : "Create shop and continue to billing"}
      </button>
      {state && (
        <p className="notice error" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
