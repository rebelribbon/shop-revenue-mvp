"use client";
import { useState } from "react";
import { createCustomerAction } from "@/server/actions/customers";
export type CustomerChoice = { id: string; name: string };
export function CustomerPicker({
  options,
  value,
  onChange,
  id = "customerId",
}: {
  options: CustomerChoice[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  const [query, setQuery] = useState(""),
    [added, setAdded] = useState<CustomerChoice[]>([]),
    [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [phone, setPhone] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const all = [
      ...options,
      ...added.filter((a) => !options.some((o) => o.id === a.id)),
    ],
    matches = all.filter((c) =>
      c.name.toLowerCase().includes(query.trim().toLowerCase()),
    ),
    visible = matches.slice(0, 50);
  const selected = all.find((c) => c.id === value);
  if (selected && !visible.some((c) => c.id === value))
    visible.unshift(selected);
  return (
    <section>
      <label htmlFor={`${id}-search`}>Find customer</label>
      <input
        id={`${id}-search`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a name…"
      />
      <label htmlFor={id}>Customer</label>
      <select
        id={id}
        name="customerId"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose customer</option>
        {visible.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {matches.length > 50 && (
        <p className="muted">
          Showing 50 matches. Type more of the name to narrow the list.
        </p>
      )}
      <details>
        <summary>Add customer here</summary>
        <label htmlFor={`${id}-first`}>New customer first name</label>
        <input
          id={`${id}-first`}
          value={first}
          maxLength={100}
          onChange={(e) => setFirst(e.target.value)}
        />
        <label htmlFor={`${id}-last`}>New customer last name</label>
        <input
          id={`${id}-last`}
          value={last}
          maxLength={100}
          onChange={(e) => setLast(e.target.value)}
        />
        <label htmlFor={`${id}-phone`}>New customer phone</label>
        <input
          id={`${id}-phone`}
          type="tel"
          value={phone}
          maxLength={40}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            if (!first.trim() && !last.trim()) {
              setMessage("Enter a name.");
              return;
            }
            setBusy(true);
            try {
              const r = await createCustomerAction({
                firstName: first,
                lastName: last,
                phone,
                clientRequestId: crypto.randomUUID(),
              });
              if (r.ok) {
                const data = r.data as { id: string; displayName: string };
                setAdded((a) => [
                  ...a,
                  { id: data.id, name: data.displayName },
                ]);
                setQuery("");
                onChange(data.id);
                setMessage("Customer added and selected.");
                setFirst("");
                setLast("");
                setPhone("");
              } else setMessage(r.error.message);
            } catch {
              setMessage("Could not add the customer. Your entries are kept.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Add and select customer
        </button>
        <p role="status">{message}</p>
      </details>
    </section>
  );
}
