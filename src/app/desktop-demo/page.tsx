import Link from "next/link";
import type { Metadata } from "next";
import styles from "./desktop-demo.module.css";

export const metadata: Metadata = {
  title: "Desktop Design Preview | Shop Revenue",
  robots: { index: false, follow: false },
};

const work = [
  { name: "Front brake pads and rotors", price: 425, cost: 175, status: "Approved" },
  { name: "Brake fluid flush", price: 180, cost: 55, status: "Pending" },
  { name: "Multi-point inspection", price: 80, cost: 20, status: "Approved" },
];
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const history = [
  { id: "RO-10482", title: "Brake Service", asset: "2021 Ford F-150", date: "Nov 9, 2026", status: "In progress" },
  { id: "RO-10193", title: "Oil Change & Inspection", asset: "2021 Ford F-150", date: "Aug 18, 2026", status: "Completed" },
  { id: "RO-09914", title: "Battery Replacement", asset: "2018 Honda Accord", date: "Apr 3, 2026", status: "Completed" },
];
export default async function DesktopDemo({ searchParams }: { searchParams: Promise<{ screen?: string; mode?: string }> }) {
  const params = await searchParams;
  const customerScreen = params.screen !== "ro";
  const internal = !customerScreen && params.mode === "internal";
  const subtotal = work.reduce((sum, item) => sum + item.price, 0);
  const costs = work.reduce((sum, item) => sum + item.cost, 0);
  return (
    <main id="main-content" className={styles.demo}>
      <div className={styles.notice}><strong>DESIGN PREVIEW · SAMPLE DATA ONLY</strong><span>No login, real customers, real payments, or document sending.</span></div>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>◆ <span>SHOP REVENUE</span></div>
          <div className={styles.eyebrow}>WORKSPACE</div>
          <nav aria-label="Preview sections" className={styles.sideNav}>
            <span>▦ <span>Appointments</span></span>
            <span>☑ <span>Tasks</span></span>
            <Link className={customerScreen ? styles.selected : ""} href="/desktop-demo?screen=customer">♙ <span>Customers</span></Link>
            <Link className={!customerScreen ? styles.selected : ""} href="/desktop-demo?screen=ro">▤ <span>Jobs / ROs</span></Link>
            <span>▥ <span>Reports</span></span>
          </nav>
          <div className={styles.bottom}>
            <div className={styles.eyebrow}>VIEW MODE</div>
            <div className={styles.switcher} aria-label="Repair order view selector">
              <Link aria-current={!internal ? "page" : undefined} className={!internal ? styles.active : ""} href={customerScreen ? "/desktop-demo?screen=customer" : "/desktop-demo?screen=ro&mode=customer"}>Customer</Link>
              <Link aria-current={internal ? "page" : undefined} className={internal ? styles.active : ""} href="/desktop-demo?screen=ro&mode=internal">Internal</Link>
            </div>
          </div>
        </aside>
        <div className={styles.app}>
          <header className={styles.topbar}><div className={styles.search}>⌕ &nbsp; Search customers, ROs, vehicles...</div><span className={styles.avatar}>SR</span></header>
          <div className={styles.page}>
            <div className={styles.breadcrumb}>Customers / John Smith {!customerScreen && "/ RO-10482"}</div>
            <div className={styles.customerHead}>
              <div className={styles.initials}>JS</div>
              <div className={styles.identity}>
                <div className={styles.titleRow}><h1>John Smith</h1><span className={styles.status}>Active customer</span></div>
                <div className={styles.contact}>(210) 555-0184 <span>·</span> john@example.com <span>·</span> 123 Main St, San Antonio, TX</div>
              </div>
            </div>
            <div className={styles.metrics}>
              <div><span>REPAIR ORDERS</span><strong>3</strong></div>
              <div><span>VEHICLES</span><strong>2</strong></div>
              <div><span>OPEN TASKS</span><strong>1</strong></div>
              <div><span>LAST VISIT</span><strong>Nov 9</strong></div>
            </div>
            {customerScreen ? (
              <div className={styles.panel}>
                <div className={styles.panelHeader}><div><h2>Customer history</h2><p>Every repair order stays linked to the vehicle and original customer record.</p></div><span className={styles.pill}>3 repair orders</span></div>
                <div className={styles.tabs}><strong>History</strong><span>Vehicles</span><span>Appointments</span><span>Communications</span></div>
                <div className={styles.tableWrap}><table><thead><tr><th>RO Number</th><th>Service / Reason</th><th>Vehicle</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>
                  {history.map(item => <tr key={item.id}><td><strong>{item.id}</strong></td><td>{item.title}</td><td>{item.asset}</td><td>{item.date}</td><td>{item.status}</td><td><Link href="/desktop-demo?screen=ro">Open →</Link></td></tr>)}
                </tbody></table></div>
              </div>
            ) : (
              <>
                <div className={styles.roHead}><div><div className={styles.eyebrow}>REPAIR ORDER · RO-10482</div><h2>Brake Service</h2><p>2021 Ford F-150 · VIN ending 4821</p></div><span className={styles.pill}>In progress</span></div>
                <div className={styles.tabs}><strong>Overview</strong><span>Estimate</span><span>Work</span><span>Documents</span><span>Cashiering</span></div>
                <div className={styles.columns}>
                  <div className={styles.panel}><div className={styles.panelHeader}><h2>Work & customer selections</h2><span className={styles.pill}>3 jobs</span></div>
                    <div className={styles.tableWrap}><table><thead><tr><th>Job</th><th>Approval</th><th>Customer price</th>{internal && <><th>Internal cost</th><th>Gross profit</th></>}</tr></thead><tbody>{work.map(item => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.status}</td><td>{money(item.price)}</td>{internal && <><td>{money(item.cost)}</td><td>{money(item.price-item.cost)}</td></>}</tr>)}</tbody></table></div>
                    <div className={styles.note}>{internal ? "Internal mode · financial details visible to authorized staff only." : "Customer mode · prices and authorizations only. No internal cost or profit fields."}</div>
                  </div>
                  <div className={styles.panel}><div className={styles.panelHeader}><h2>RO summary</h2></div><div className={styles.summaryLine}><span>Customer subtotal</span><strong>{money(subtotal)}</strong></div>{internal && <><div className={styles.summaryLine}><span>Internal cost</span><strong>{money(costs)}</strong></div><div className={styles.summaryLine}><span>Gross profit</span><strong>{money(subtotal-costs)}</strong></div></>}<div className={styles.summaryLine}><span>Payment collected</span><strong>$0.00</strong></div><div className={styles.note}>Customer authorization and payment statuses are illustrative.</div></div>
                </div>
                <div className={styles.back}><Link href="/desktop-demo?screen=customer">← Back to customer history</Link></div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
