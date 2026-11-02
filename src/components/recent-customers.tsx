"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

// Customers opened recently on this device, newest first.
const KEY = "shop-revenue:recent-customers";
type Recent = { id: string; name: string; at: number };
const read = (): Recent[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function RememberCustomer({ id, name }: { id: string; name: string }) {
  useEffect(() => {
    try {
      const next = [
        { id, name, at: Date.now() },
        ...read().filter((r) => r.id !== id),
      ].slice(0, 8);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: nothing to remember */
    }
  }, [id, name]);
  return null;
}

export function RecentCustomers() {
  const [items, setItems] = useState<Recent[]>([]);
  useEffect(() => {
    // Read after mount: browser storage isn't available on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(read());
  }, []);
  if (!items.length) return null;
  return (
    <section className="card" aria-label="Recently viewed customers">
      <h2>Recently viewed</h2>
      <div className="record-shortcuts">
        {items.map((r) => (
          <Link key={r.id} href={`/app/customers/${r.id}`}>
            {r.name}
          </Link>
        ))}
      </div>
    </section>
  );
}
