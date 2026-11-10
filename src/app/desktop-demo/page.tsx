import Link from "next/link";
import type { Metadata } from "next";
import styles from "./desktop-demo.module.css";
import { RoWorkspace } from "./ro-workspace";
import { VehicleWorkspace } from "./vehicle-workspace";

export const metadata: Metadata = {
  title: "Desktop Design Preview | Shop Revenue",
  robots: { index: false, follow: false },
};

const history = [
  {
    id: "RO-10482",
    title: "Brake Service",
    asset: "2021 Ford F-150",
    date: "Nov 9, 2026",
    status: "In progress",
  },
  {
    id: "RO-10193",
    title: "Oil Change & Inspection",
    asset: "2021 Ford F-150",
    date: "Aug 18, 2026",
    status: "Completed",
  },
  {
    id: "RO-09914",
    title: "Battery Replacement",
    asset: "2018 Honda Accord",
    date: "Apr 3, 2026",
    status: "Completed",
  },
];
export default async function DesktopDemo({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string; mode?: string; ro?: string; vehicle?: string; title?: string }>;
}) {
  const params = await searchParams;
  const customerScreen = params.screen !== "ro";
  const vehiclesScreen = params.screen === "vehicles";
  const vehicleScreen = params.screen === "vehicle";
  const vehicleId = params.vehicle === "accord" ? "accord" : "f150";
  const listScreen = params.screen === "customers";
  const internal = !customerScreen && params.mode === "internal";
  const roId =
    ["RO-10482", "RO-10193", "RO-09914"].includes(params.ro ?? "") ||
    /^RO-DEMO-[A-F0-9]{8}$/.test(params.ro ?? "")
      ? params.ro!
      : "RO-10482";
  const newTitle = params.title?.slice(0, 100) ?? "";
  return (
    <main id="main-content" className={styles.demo}>
      <div className={styles.notice}>
        <strong>DESIGN PREVIEW · SAMPLE DATA ONLY</strong>
        <span>
          No login, real customers, real payments, or document sending.
        </span>
      </div>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            ◆ <span>SHOP REVENUE</span>
          </div>
          <div className={styles.eyebrow}>WORKSPACE</div>
          <nav aria-label="Preview sections" className={styles.sideNav}>
            <span>
              ▦ <span>Appointments</span>
            </span>
            <span>
              ☑ <span>Tasks</span>
            </span>
            <Link
              className={customerScreen ? styles.selected : ""}
              href="/desktop-demo?screen=customers"
            >
              ♙ <span>Customers</span>
            </Link>
            <Link
              className={!customerScreen ? styles.selected : ""}
              href="/desktop-demo?screen=ro&ro=RO-10482"
            >
              ▤ <span>Jobs / ROs</span>
            </Link>
            <span>
              ▥ <span>Reports</span>
            </span>
          </nav>
          {!customerScreen && (
            <div className={styles.bottom}>
              <div className={styles.eyebrow}>RO VIEW MODE</div>
              <div
                className={styles.switcher}
                aria-label="Repair order view selector"
              >
                <Link
                  aria-current={!internal ? "page" : undefined}
                  className={!internal ? styles.active : ""}
                  href={`/desktop-demo?screen=ro&ro=${roId}&mode=customer`}
                >
                  Customer
                </Link>
                <Link
                  aria-current={internal ? "page" : undefined}
                  className={internal ? styles.active : ""}
                  href={`/desktop-demo?screen=ro&ro=${roId}&mode=internal`}
                >
                  Internal
                </Link>
              </div>
            </div>
          )}
        </aside>
        <div className={styles.app}>
          <header className={styles.topbar}>
            <div className={styles.search}>
              ⌕ &nbsp; Search customers, ROs, vehicles...
            </div>
            <span className={styles.avatar}>SR</span>
          </header>
          <div className={styles.page}>
            <div className={styles.breadcrumb}>
              {listScreen ? "Customers" : (
                <>Customers / John Smith {vehiclesScreen ? "/ Vehicles" : vehicleScreen ? "/ Vehicles / Vehicle Details" : !customerScreen ? `/ ${roId}` : ""}</>
              )}
            </div>
            {!listScreen && (
              <div className={styles.customerHead}>
                <div className={styles.initials}>JS</div>
                <div className={styles.identity}>
                  <div className={styles.titleRow}>
                    <h1>John Smith</h1>
                    <span className={styles.status}>Active customer</span>
                  </div>
                  <div className={styles.contact}>
                    (210) 555-0184 <span>·</span> john@example.com{" "}
                    <span>·</span> 123 Main St, San Antonio, TX
                  </div>
                </div>
              </div>
            )}
            {!listScreen && !vehiclesScreen && !vehicleScreen && (
              <div className={styles.metrics}>
                <div>
                  <span>REPAIR ORDERS</span>
                  <strong>3</strong>
                </div>
                <div>
                  <span>VEHICLES</span>
                  <strong>2</strong>
                </div>
                <div>
                  <span>OPEN TASKS</span>
                  <strong>1</strong>
                </div>
                <div>
                  <span>LAST VISIT</span>
                  <strong>Nov 9</strong>
                </div>
              </div>
            )}
            {vehiclesScreen || vehicleScreen ? (
              <>
                <p className={styles.customerReturn}>
                  <Link className={styles.returnButton} href="/desktop-demo?screen=customer">← Customer Profile</Link>
                </p>
                <div className={styles.tabs} aria-label="Customer sections">
                  <Link href="/desktop-demo?screen=customer">History</Link>
                  <strong>Vehicles</strong>
                  <span>Appointments</span><span>Communications</span>
                </div>
                <VehicleWorkspace vehicleId={vehicleScreen ? vehicleId : undefined}/>
              </>
            ) : listScreen ? (
              <section className={styles.panel} aria-label="Customer directory">
                <div className={styles.panelHeader}>
                  <div>
                    <h2>All Customers</h2>
                    <p>
                      Browse customer records and open a profile. Sample data
                      only.
                    </p>
                  </div>
                  <span className={styles.pill}>3 customers</span>
                </div>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Contact</th>
                        <th>Vehicle</th>
                        <th>ROs</th>
                        <th>Profile</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <strong>John Smith</strong>
                        </td>
                        <td>john@example.com</td>
                        <td>2021 Ford F-150</td>
                        <td>3</td>
                        <td>
                          <Link href="/desktop-demo?screen=customer">
                            Open profile →
                          </Link>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <strong>Maria Garcia</strong>
                        </td>
                        <td>maria@example.com</td>
                        <td>2020 Honda CR-V</td>
                        <td>2</td>
                        <td>
                          <Link href="/desktop-demo?screen=customer">
                            Open sample profile →
                          </Link>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <strong>Alex Johnson</strong>
                        </td>
                        <td>alex@example.com</td>
                        <td>2019 Chevrolet Silverado</td>
                        <td>1</td>
                        <td>
                          <Link href="/desktop-demo?screen=customer">
                            Open sample profile →
                          </Link>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className={styles.note}>
                  The preview uses one interactive customer record (John Smith);
                  other rows are illustrative.
                </div>
              </section>
            ) : customerScreen ? (
              <>
                <p className={styles.customerReturn}>
                  <Link
                    className={styles.returnButton}
                    href="/desktop-demo?screen=customers"
                  >
                    ← All Customers
                  </Link>
                </p>
                <div className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <div>
                      <h2>Customer history</h2>
                      <p>
                        Every repair order stays linked to the vehicle and
                        original customer record.
                      </p>
                    </div>
                    <span className={styles.pill}>3 repair orders</span>
                  </div>
                  <div className={styles.tabs}>
                    <strong>History</strong>
                    <Link href="/desktop-demo?screen=vehicles">Vehicles</Link>
                    <span>Appointments</span>
                    <span>Communications</span>
                  </div>
                  <div className={styles.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          <th>RO Number</th>
                          <th>Service / Reason</th>
                          <th>Vehicle</th>
                          <th>Date</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.id}</strong>
                            </td>
                            <td>{item.title}</td>
                            <td>{item.asset}</td>
                            <td>{item.date}</td>
                            <td>{item.status}</td>
                            <td>
                              <Link
                                href={`/desktop-demo?screen=ro&ro=${item.id}`}
                              >
                                Open →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <>
                <RoWorkspace
                  key={`${roId}-${internal ? "internal" : "customer"}`}
                  internal={internal}
                  roId={roId}
                  vehicleId={vehicleId}
                  newTitle={newTitle}
                />
                <div className={styles.back}>
                  <Link href="/desktop-demo?screen=customer">
                    ← Back to customer history
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
