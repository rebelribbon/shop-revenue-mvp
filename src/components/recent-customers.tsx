"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RecordSection } from "./record-section";

// Customers opened recently on this device, newest first.
const key = (scope: string) => `shop-revenue:recent-customers:v1:${scope}`;
type Recent = { id: string; name: string; at: number };
const read = (scope: string): Recent[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(scope)) ?? "[]");
    return Array.isArray(v)
      ? v
          .filter(
            (r): r is Recent =>
              r &&
              typeof r === "object" &&
              typeof r.id === "string" &&
              r.id.length > 0 &&
              r.id.length <= 100 &&
              typeof r.name === "string" &&
              r.name.trim().length > 0 &&
              r.name.length <= 240 &&
              typeof r.at === "number" &&
              Number.isFinite(r.at),
          )
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
};

export function RememberCustomer({
  id,
  name,
  scope,
}: {
  id: string;
  name: string;
  scope: string;
}) {
  useEffect(() => {
    try {
      const next = [
        { id, name, at: Date.now() },
        ...read(scope).filter((r) => r.id !== id),
      ].slice(0, 8);
      localStorage.setItem(key(scope), JSON.stringify(next));
    } catch {
      /* private mode: nothing to remember */
    }
  }, [id, name, scope]);
  return null;
}

export function RecentCustomers({
  scope,
  demo = false,
}: {
  scope: string;
  demo?: boolean;
}) {
  const [state, setState] = useState<{ scope: string; items: Recent[] }>({
    scope,
    items: [],
  });
  useEffect(() => {
    // Read after mount: browser storage isn't available on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ scope, items: read(scope) });
  }, [scope]);
  const items = state.scope === scope ? state.items.slice(0, 4) : [];
  if (!items.length) return null;
  return (
    <RecordSection
      title="Recently viewed customers"
      className="record-recent-customers"
    >
      <div className="recent-customer-shortcuts">
        {items.map((r) => (
          <Link
            key={r.id}
            className="btn secondary"
            href={
              demo
                ? `/demo/crm?customer=${encodeURIComponent(r.id)}`
                : `/app/customers/${encodeURIComponent(r.id)}`
            }
          >
            {r.name}
          </Link>
        ))}
      </div>
    </RecordSection>
  );
}
