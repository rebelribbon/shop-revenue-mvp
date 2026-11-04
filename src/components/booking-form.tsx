"use client";
import { useState } from "react";
import { requestBookingAction } from "@/server/actions/booking";
import { useActionHydration } from "./action-hydration";

export function BookingForm({
  slug,
  automotive,
}: {
  slug: string;
  automotive: boolean;
}) {
  const ready = useActionHydration();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (sent)
    return (
      <section className="card" role="status">
        <h2>Thanks — we got it</h2>
        <p>We’ll call you shortly to set a time.</p>
      </section>
    );
  return (
    <form
      className="card"
      data-ux-ready={ready}
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        setPending(true);
        setMessage("");
        const f = Object.fromEntries(new FormData(e.currentTarget));
        try {
          const r = await requestBookingAction({ ...f, slug });
          if (r.ok) setSent(true);
          else setMessage(r.error.message);
        } catch {
          setMessage("Something went wrong. Please call the shop.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor="bk-first">First name</label>
      <input
        id="bk-first"
        name="firstName"
        required
        maxLength={100}
        autoComplete="given-name"
      />
      <label htmlFor="bk-last">Last name</label>
      <input
        id="bk-last"
        name="lastName"
        maxLength={100}
        autoComplete="family-name"
      />
      <label htmlFor="bk-phone">Mobile phone</label>
      <input
        id="bk-phone"
        name="phone"
        type="tel"
        required
        maxLength={40}
        autoComplete="tel"
      />
      <label htmlFor="bk-email">Email (optional)</label>
      <input
        id="bk-email"
        name="email"
        type="email"
        maxLength={254}
        autoComplete="email"
      />
      <label htmlFor="bk-what">
        {automotive ? "Year, make and model" : "Service address"}
      </label>
      <input id="bk-what" name="what" maxLength={200} />
      <label htmlFor="bk-service">What do you need?</label>
      <textarea id="bk-service" name="service" rows={3} maxLength={500} />
      <label htmlFor="bk-when">When works best? (optional)</label>
      <input
        id="bk-when"
        name="when"
        maxLength={100}
        placeholder="e.g. Tuesday morning"
      />
      <button className="btn primary" disabled={!ready || pending}>
        {pending ? "Sending…" : "Request a visit"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
