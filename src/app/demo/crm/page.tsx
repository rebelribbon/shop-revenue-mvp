import Link from "next/link";
import type { Metadata } from "next";
import { WorkspaceIcon } from "@/components/workspace-icon";
import { demoCustomers as customers } from "@/lib/demo-customers";

export const metadata: Metadata = {
  title: "CRM workspace preview | Shop Revenue",
  robots: { index: false, follow: false },
};

const tabs = ["Overview", "Jobs", "Vehicles", "History", "Details"] as const;

export default async function CrmPreview({
  searchParams,
}: {
  searchParams: Promise<{
    customer?: string;
    tab?: string;
    q?: string;
    view?: string;
  }>;
}) {
  const { customer, tab, q, view } = await searchParams;
  const search = (q ?? "").trim();
  const filtered = customers.filter((c) =>
    `${c.name} ${c.asset} ${c.contact}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const who = customers.find((c) => c.id === customer);
  const activeTab = tabs.includes(tab as (typeof tabs)[number])
    ? (tab as (typeof tabs)[number])
    : "Overview";
  const url = who ? `/demo/crm?customer=${who.id}` : "/demo/crm";
  return (
    <main id="main-content" className="crm-sample" tabIndex={-1}>
      <header className="crm-sample-head">
        <Link href="/demo/crm" className="crm-sample-brand">
          Shop Revenue
        </Link>
        <span className="muted">
          Interactive layout preview · Sample data only
        </span>
      </header>
      <div className="crm-sample-shell">
        <nav
          className="crm-sample-side"
          aria-label="Sample workspace navigation"
        >
          <Link
            href="/demo/crm?view=appointments"
            aria-current={!who && view === "appointments" ? "page" : undefined}
          >
            Appointments
          </Link>
          <Link
            href="/demo/crm?view=tasks"
            aria-current={!who && view === "tasks" ? "page" : undefined}
          >
            Tasks
          </Link>
          <Link
            href="/demo/crm"
            aria-current={who || !view ? "page" : undefined}
          >
            Customers
          </Link>
          <Link
            href="/demo/crm?view=jobs"
            aria-current={!who && view === "jobs" ? "page" : undefined}
          >
            Jobs / ROs
          </Link>
          <Link
            href="/demo/crm?view=reports"
            aria-current={!who && view === "reports" ? "page" : undefined}
          >
            Reports
          </Link>
        </nav>
        <div className="crm-sample-content">
          {!who && view === "appointments" ? (
            <section className="demo-job-panel">
              <h1>Appointments</h1>
              <p>Book and manage customer appointments from here.</p>
              <div className="customer-overview-grid">
                <article className="card customer-overview-card">
                  <h2>Scheduled service</h2>
                  <p>Front brake service · Alex Example</p>
                  <Link
                    href="/demo/appointment?customer=alex"
                    className="btn primary"
                  >
                    + Book appointment
                  </Link>
                </article>
                <article className="card customer-overview-card">
                  <h2>Follow-up</h2>
                  <p>Contact Alex Example about the estimate.</p>
                  <Link href="/demo/crm?view=tasks" className="btn secondary">
                    View tasks
                  </Link>
                </article>
              </div>
            </section>
          ) : !who && view === "tasks" ? (
            <section className="demo-job-panel">
              <h1>Tasks</h1>
              <p>Pending follow-ups for sample customers.</p>
              <Link
                href="/demo/crm?customer=alex"
                className="customer-work-row"
              >
                <strong>Follow up with Alex Example</strong>
                <span>Due today</span>
              </Link>
              <Link href="/demo/job" className="customer-work-row">
                <strong>Send brake service estimate</strong>
                <span>Awaiting approval</span>
              </Link>
            </section>
          ) : !who && view === "jobs" ? (
            <section className="demo-job-panel">
              <h1>Jobs / ROs</h1>
              <p>
                Every job belongs to a customer. Open an RO for work, documents
                and payment.
              </p>
              <Link className="customer-work-row" href="/demo/job">
                <strong>RO #10042 · Front brake service</strong>
                <span>Alex Example · Awaiting approval</span>
              </Link>
              <Link
                className="btn primary"
                href="/demo/crm?customer=alex&tab=Jobs"
              >
                View customer&apos;s RO history
              </Link>
            </section>
          ) : !who && view === "reports" ? (
            <section className="demo-job-panel">
              <h1>Reports</h1>
              <p>
                Operational and financial performance, separate from job
                payments.
              </p>
              <div className="customer-overview-grid">
                <article className="card customer-overview-card">
                  <h2>Appointments</h2>
                  <p>Scheduled: 4 · Completed: 3</p>
                </article>
                <article className="card customer-overview-card">
                  <h2>Work</h2>
                  <p>ROs opened: 8 · Awaiting approval: 2</p>
                </article>
                <article className="card customer-overview-card">
                  <h2>Customers</h2>
                  <p>New: 6 · Returning: 12</p>
                </article>
                <article className="card customer-overview-card">
                  <h2>Revenue</h2>
                  <p>Invoiced: $8,420 · Collected: $6,800</p>
                </article>
              </div>
              <p className="muted">
                Illustrative report data. The authenticated Reports tab uses
                real shop data.
              </p>
            </section>
          ) : !who ? (
            <>
              <div className="customer-list-heading">
                <div>
                  <h1>Customers</h1>
                  <p className="muted">
                    Find people, open their history, and get right to work.
                  </p>
                </div>
                <Link className="btn primary" href="/demo/customer/new">
                  + Customer
                </Link>
              </div>
              <form
                className="crm-sample-search-form"
                method="get"
                action="/demo/crm"
                role="search"
              >
                <label htmlFor="demo-customer-search">Find customer</label>
                <div className="crm-sample-search-controls">
                  <input
                    id="demo-customer-search"
                    name="q"
                    type="search"
                    defaultValue={search}
                    placeholder="Search customers"
                  />
                  <button className="btn secondary" type="submit">
                    Search
                  </button>
                </div>
              </form>
              <Link href="/demo/job" className="crm-sample-pricing-link">
                Try job setup & pricing →
              </Link>
              <p className="muted">Sample customers</p>
              <ul className="customer-directory">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <Link
                      className="customer-directory-row"
                      href={`/demo/crm?customer=${c.id}`}
                    >
                      <span className="customer-avatar" aria-hidden="true">
                        {c.name.charAt(0)}
                      </span>
                      <span className="customer-directory-main">
                        <strong>{c.name}</strong>
                        <span className="muted">{c.asset}</span>
                        <span className="customer-directory-contact">
                          {c.contact}
                        </span>
                      </span>
                      <span
                        className="customer-directory-chevron"
                        aria-hidden="true"
                      >
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {!filtered.length && (
                <p className="muted">No matching sample customers.</p>
              )}
            </>
          ) : (
            <>
              <Link href="/demo/crm" className="crm-sample-back">
                ← Customers
              </Link>
              <header className="customer-hero">
                <div className="customer-hero-main">
                  <div className="customer-hero-avatar">
                    {who.name.charAt(0)}
                  </div>
                  <div>
                    <p className="customer-eyebrow">Customer record</p>
                    <h1>{who.name}</h1>
                    <p className="muted">{who.asset}</p>
                  </div>
                </div>
                <div
                  className="customer-hero-actions"
                  aria-label="Sample actions"
                >
                  <Link
                    className="btn secondary"
                    href={`/demo/crm?customer=${who.id}&tab=Details`}
                  >
                    Contact
                  </Link>
                  <Link
                    className="btn secondary"
                    href={`/demo/crm?customer=${who.id}&tab=History`}
                  >
                    History
                  </Link>
                  <Link
                    className="btn secondary"
                    href={`/demo/appointment?customer=${who.id}`}
                  >
                    + Appointment
                  </Link>
                  <Link className="btn primary" href="/demo/job">
                    + New RO
                  </Link>
                </div>
              </header>
              <div className="profile-layout customer-profile-layout">
                <aside className="card profile-card customer-profile-side">
                  <h2>Customer details</h2>
                  <p className="muted">
                    Customer profile, saved preferences, and account links live
                    here.
                  </p>
                  <p>
                    <strong>Outstanding</strong> &nbsp; $1,284.75
                  </p>
                  <p>
                    <strong>Lifetime payments</strong> &nbsp; $4,750.00
                  </p>
                  <p className="muted">
                    Additional settings stay accessible without cluttering the
                    main screen.
                  </p>
                </aside>
                <div className="profile-main customer-profile-main">
                  <nav
                    className="section-tabs customer-record-tabs"
                    aria-label="Customer sections"
                  >
                    {tabs.map((t) => (
                      <Link
                        key={t}
                        href={`${url}&tab=${t}`}
                        aria-current={activeTab === t ? "page" : undefined}
                      >
                        {t}
                      </Link>
                    ))}
                  </nav>
                  {activeTab === "Overview" ? (
                    <section className="customer-overview-grid">
                      <article className="card customer-overview-card">
                        <div className="section-heading">
                          <h2>Contact</h2>
                          <span className="muted">Edit</span>
                        </div>
                        <div className="customer-fact">
                          <strong>Mobile</strong>
                          <span>{who.contact}</span>
                        </div>
                        <div className="customer-fact">
                          <strong>Email</strong>
                          <span>alex@example.test</span>
                        </div>
                        <div className="customer-fact">
                          <strong>Address</strong>
                          <span>San Antonio, TX</span>
                        </div>
                      </article>
                      <article className="card customer-overview-card">
                        <div className="section-heading">
                          <h2>Recent ROs</h2>
                          <Link href={`${url}&tab=Jobs`}>RO history</Link>
                        </div>
                        <Link
                          className="customer-work-row"
                          href={`${url}&tab=Jobs`}
                        >
                          <strong>RO #10042 · Brake service</strong>
                          <span>Awaiting approval</span>
                          <span>$1,284.75 due</span>
                        </Link>
                      </article>
                      <article className="card customer-overview-card">
                        <div className="section-heading">
                          <h2>Recent activity</h2>
                          <Link href={`${url}&tab=History`}>History</Link>
                        </div>
                        <div className="customer-activity-row">
                          Estimate prepared{" "}
                          <small className="muted">Today</small>
                        </div>
                        <div className="customer-activity-row">
                          Customer called{" "}
                          <small className="muted">Yesterday</small>
                        </div>
                      </article>
                      <article className="card customer-overview-card">
                        <div className="section-heading">
                          <h2>Vehicles</h2>
                          <Link href={`${url}&tab=Vehicles`}>View all</Link>
                        </div>
                        <p>{who.asset}</p>
                      </article>
                    </section>
                  ) : (
                    <section className="card customer-overview-card">
                      <h2>{activeTab}</h2>
                      <p className="muted">
                        {activeTab === "Jobs"
                          ? "RO #10042 · Brake service · Awaiting customer authorization · $1,284.75"
                          : activeTab === "Vehicles"
                            ? who.asset
                            : activeTab === "History"
                              ? "Estimate prepared today · Customer called yesterday"
                              : "Contact details and communication preferences"}
                      </p>
                      {activeTab === "Jobs" && (
                        <Link href="/demo/job" className="btn primary">
                          Open job setup & pricing
                        </Link>
                      )}
                    </section>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <nav
        className="crm-sample-mobile-nav"
        aria-label="Mobile sample navigation"
      >
        {(
          [
            {
              label: "Appts",
              href: "/demo/crm?view=appointments",
              icon: "schedule",
              current: !who && view === "appointments",
            },
            {
              label: "Tasks",
              href: "/demo/crm?view=tasks",
              icon: "tasks",
              current: !who && view === "tasks",
            },
            {
              label: "Customers",
              href: "/demo/crm",
              icon: "customers",
              current: Boolean(who) || !view,
            },
            {
              label: "Jobs",
              href: "/demo/crm?view=jobs",
              icon: "work",
              current: !who && view === "jobs",
            },
            {
              label: "Reports",
              href: "/demo/crm?view=reports",
              icon: "reports",
              current: !who && view === "reports",
            },
          ] as const
        ).map((item) => (
          <Link
            key={item.label}
            href={item.href}
            aria-label={item.label}
            aria-current={item.current ? "page" : undefined}
          >
            <WorkspaceIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
