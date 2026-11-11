"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./desktop-demo.module.css";

export const demoVehicles = [
  {
    id: "f150",
    name: "2021 Ford F-150",
    trim: "Lariat 4WD",
    vin: "•••• •••• •••• 4821",
    plate: "TX · JSM-4821",
    mileage: "67,240 mi",
    roIds: ["RO-10482", "RO-10193"],
  },
  {
    id: "accord",
    name: "2018 Honda Accord",
    trim: "EX-L",
    vin: "•••• •••• •••• 9134",
    plate: "TX · JSM-9134",
    mileage: "92,410 mi",
    roIds: ["RO-09914"],
  },
] as const;

export const demoOrders = [
  {
    id: "RO-10482",
    title: "Brake Service",
    vehicleId: "f150",
    date: "Nov 9, 2026",
    status: "In progress",
  },
  {
    id: "RO-10193",
    title: "Oil Change & Inspection",
    vehicleId: "f150",
    date: "Aug 18, 2026",
    status: "Completed",
  },
  {
    id: "RO-09914",
    title: "Battery Replacement",
    vehicleId: "accord",
    date: "Apr 3, 2026",
    status: "Completed",
  },
];

type NewOrder = {
  id: string;
  title: string;
  vehicleId: string;
  date: string;
  status: "Draft";
};

export function VehicleWorkspace({ vehicleId }: { vehicleId?: string }) {
  const router = useRouter();
  const [newOrders, setNewOrders] = useState<NewOrder[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    try {
      const value = sessionStorage.getItem(
        "shop-revenue-desktop-demo-new-ros-v1",
      );
      const parsed: unknown = value ? JSON.parse(value) : [];
      if (Array.isArray(parsed)) {
        queueMicrotask(() => {
          if (active)
            setNewOrders(
              parsed.filter(
                (row) =>
                  row &&
                  typeof row.id === "string" &&
                  typeof row.vehicleId === "string" &&
                  typeof row.title === "string" &&
                  row.status === "Draft",
              ) as NewOrder[],
            );
        });
      }
    } catch {
      // In a private browsing session the sample list still works.
    }
    return () => {
      active = false;
    };
  }, []);
  const selected = demoVehicles.find((vehicle) => vehicle.id === vehicleId);
  const allOrders = [...demoOrders, ...newOrders];
  function createOrder() {
    if (!selected) return;
    if (!title.trim()) {
      setError("Enter a short reason for the repair order.");
      return;
    }
    const id = `RO-DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const created: NewOrder = {
      id,
      title: title.trim(),
      vehicleId: selected.id,
      date: "Nov 9, 2026",
      status: "Draft",
    };
    try {
      const next = [...newOrders, created];
      sessionStorage.setItem(
        "shop-revenue-desktop-demo-new-ros-v1",
        JSON.stringify(next),
      );
      sessionStorage.setItem(
        `shop-revenue-desktop-demo-new-ro:${id}`,
        JSON.stringify(created),
      );
    } catch {
      // Query params still retain vehicle association for the current demo session.
    }
    router.push(
      `/desktop-demo?screen=ro&ro=${encodeURIComponent(id)}&vehicle=${selected.id}&title=${encodeURIComponent(created.title)}`,
    );
  }
  if (!selected) {
    return (
      <section className={styles.panel} aria-label="Customer vehicles">
        <div className={styles.panelHeader}>
          <div>
            <h2>Vehicles</h2>
            <p>
              All vehicles registered to John Smith. Select a vehicle to see its
              own history and active work.
            </p>
          </div>
          <span className={styles.pill}>2 vehicles</span>
        </div>
        <div className={styles.vehicleCards}>
          {demoVehicles.map((vehicle) => {
            const orders = allOrders.filter(
              (order) => order.vehicleId === vehicle.id,
            );
            const active = orders.find(
              (order) =>
                order.status === "In progress" || order.status === "Draft",
            );
            return (
              <Link
                key={vehicle.id}
                className={styles.vehicleCard}
                href={`/desktop-demo?screen=vehicle&vehicle=${vehicle.id}`}
              >
                <div className={styles.vehicleAvatar}>▣</div>
                <div className={styles.vehicleInfo}>
                  <strong>{vehicle.name}</strong>
                  <span>
                    {vehicle.trim} · {vehicle.plate}
                  </span>
                  <span>
                    {vehicle.mileage} · {orders.length} ROs
                  </span>
                  {active && (
                    <span className={styles.approvedTag}>
                      Open: {active.id}
                    </span>
                  )}
                </div>
                <span className={styles.vehicleChevron}>View vehicle →</span>
              </Link>
            );
          })}
        </div>
      </section>
    );
  }
  const orders = allOrders.filter((order) => order.vehicleId === selected.id);
  const open = orders.filter(
    (order) => order.status === "In progress" || order.status === "Draft",
  );
  const past = orders.filter((order) => order.status === "Completed");
  return (
    <div className={styles.vehicleDetail}>
      <div className={styles.vehicleTop}>
        <Link
          className={styles.returnButton}
          href="/desktop-demo?screen=vehicles"
        >
          ← All Vehicles
        </Link>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setCreating((current) => !current)}
          aria-expanded={creating}
        >
          + New RO
        </button>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <div className={styles.eyebrow}>CUSTOMER VEHICLE</div>
            <h2>
              {selected.name} · {selected.trim}
            </h2>
            <p>
              {selected.vin} · {selected.plate} · {selected.mileage}
            </p>
          </div>
          <span className={styles.pill}>{orders.length} repair orders</span>
        </div>
      </section>
      {creating && (
        <form
          className={styles.addForm}
          onSubmit={(e) => {
            e.preventDefault();
            createOrder();
          }}
        >
          <h3>New repair order for {selected.name}</h3>
          <p>
            This RO will belong to this vehicle only. New services start pending
            authorization.
          </p>
          <div className={styles.formFields}>
            <label>
              Reason for visit
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Check engine light"
                required
                maxLength={100}
              />
            </label>
          </div>
          {error && (
            <p role="alert" className={styles.formError}>
              {error}
            </p>
          )}
          <div className={styles.formButtons}>
            <button type="submit" className={styles.addButton}>
              Create demo RO
            </button>
            <button type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <section className={styles.panel} aria-label="Current repair orders">
        <div className={styles.panelHeader}>
          <div>
            <h2>Current Work</h2>
            <p>Open repair orders for this vehicle only.</p>
          </div>
          <span className={styles.approvedTag}>{open.length} open</span>
        </div>
        {open.length ? (
          <OrderTable orders={open} />
        ) : (
          <p className={styles.vehicleEmpty}>
            No open repair orders for this vehicle.
          </p>
        )}
      </section>
      <section className={styles.panel} aria-label="Vehicle service history">
        <div className={styles.panelHeader}>
          <div>
            <h2>Previous Service History</h2>
            <p>Completed ROs for {selected.name}, newest first.</p>
          </div>
          <span className={styles.pill}>{past.length} completed</span>
        </div>
        {past.length ? (
          <OrderTable orders={past} />
        ) : (
          <p className={styles.vehicleEmpty}>
            No completed service history for this vehicle.
          </p>
        )}
      </section>
    </div>
  );
}
function OrderTable({
  orders,
}: {
  orders: Array<{
    id: string;
    title: string;
    date: string;
    status: string;
    vehicleId: string;
  }>;
}) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            <th>RO number</th>
            <th>Service</th>
            <th>Date</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((ro) => (
            <tr key={ro.id}>
              <td>
                <strong>{ro.id}</strong>
              </td>
              <td>{ro.title}</td>
              <td>{ro.date}</td>
              <td>{ro.status}</td>
              <td>
                <Link
                  href={`/desktop-demo?screen=ro&ro=${encodeURIComponent(ro.id)}&vehicle=${ro.vehicleId}&title=${encodeURIComponent(ro.title)}`}
                >
                  Open RO →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
