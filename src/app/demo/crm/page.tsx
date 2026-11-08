import Link from "next/link";
import type { Metadata } from "next";
import { WorkspaceIcon } from "@/components/workspace-icon";
import { RecordSection, WorkCard } from "@/components/record-section";
import { CustomerContactSummary } from "@/components/customer-contact-summary";
import { CustomerContactActions } from "@/components/customer-contact-actions";
import {
  RememberCustomer,
  RecentCustomers,
} from "@/components/recent-customers";
import {
  demoCustomers as customers,
  type DemoCustomer,
} from "@/lib/demo-customers";
import { groupWork } from "@/lib/work-sections";
import { jobStatusLabels, statusTone } from "@/lib/job-status";

export const metadata: Metadata = {
  title: "CRM workspace preview | Shop Revenue",
  robots: { index: false, follow: false },
};
const tabs = ["Overview", "Jobs", "Vehicles", "History", "Details"] as const;
const statusLabels = jobStatusLabels("automotive");
function SampleWork({
  customer,
  profile = false,
}: {
  customer: DemoCustomer;
  profile?: boolean;
}) {
  return (
    <WorkCard
      href={`/demo/job?customer=${customer.id}`}
      reference={`RO #${customer.roNumber}`}
      title="Front brake service"
      customer={profile ? undefined : customer.name}
      detail={customer.asset}
      status={statusLabels[customer.status]}
      statusClass={statusTone(customer.status)}
      amount={customer.status === "paid" ? "$0.00" : "$1,188.57"}
      amountLabel={customer.status === "paid" ? "Balance due" : "Estimate"}
      ariaLabel={
        profile
          ? "Open job setup & pricing"
          : `Open RO ${customer.roNumber} for ${customer.name}`
      }
    />
  );
}

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
  const destinations = [
    {
      label: "Appointments",
      mobile: "Appts",
      href: "/demo/crm?view=appointments",
      icon: "schedule",
      current: !who && view === "appointments",
    },
    {
      label: "Tasks",
      mobile: "Tasks",
      href: "/demo/crm?view=tasks",
      icon: "tasks",
      current: !who && view === "tasks",
    },
    {
      label: "Customers",
      mobile: "Customers",
      href: "/demo/crm",
      icon: "customers",
      current: Boolean(who) || !view,
    },
    {
      label: "Jobs / ROs",
      mobile: "Jobs",
      href: "/demo/crm?view=jobs",
      icon: "work",
      current: !who && view === "jobs",
    },
    {
      label: "Reports",
      mobile: "Reports",
      href: "/demo/crm?view=reports",
      icon: "reports",
      current: !who && view === "reports",
    },
  ] as const;
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
          {destinations.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.current ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="crm-sample-content">
          {!who && view === "appointments" ? (
            <>
              <h1>Appointments</h1>
              <RecordSection
                title="Scheduled service"
                description="Customer appointments and the work planned for each visit."
                actions={
                  <Link
                    href="/demo/appointment?customer=alex"
                    className="btn primary"
                  >
                    + Book appointment
                  </Link>
                }
              >
                <article className="record-information-card">
                  <strong>Front brake service</strong>
                  <span>Alex Example · 2019 Ford F-150</span>
                  <span className="pill">Scheduled</span>
                </article>
              </RecordSection>
              <RecordSection title="Appointment follow-up">
                <p>Contact Alex Example about the estimate.</p>
                <Link href="/demo/crm?view=tasks" className="btn secondary">
                  View tasks
                </Link>
              </RecordSection>
            </>
          ) : !who && view === "tasks" ? (
            <>
              <h1>Tasks</h1>
              <RecordSection
                title="Due today"
                count={2}
                description="The next actions for your customers and ROs."
              >
                <div className="record-work-grid">
                  <Link
                    href="/demo/crm?customer=alex"
                    className="record-information-card"
                  >
                    <strong>Follow up with Alex Example</strong>
                    <span>Customer follow-up</span>
                  </Link>
                  <Link href="/demo/job" className="record-information-card">
                    <strong>Send brake service estimate</strong>
                    <span>Awaiting approval</span>
                  </Link>
                </div>
              </RecordSection>
            </>
          ) : !who && view === "jobs" ? (
            <>
              <div className="customer-list-heading">
                <div>
                  <h1>Jobs / ROs</h1>
                  <p className="muted">
                    Work is grouped by what needs to happen next.
                  </p>
                </div>
                <Link
                  className="btn primary"
                  href="/demo/crm?customer=alex&tab=Jobs"
                >
                  View customer&apos;s RO history
                </Link>
              </div>
              <RecordSection
                title="Work overview"
                description="Open an RO to manage its work, documents and payments."
              >
                <div className="record-summary-grid">
                  {groupWork(customers, (c) => c.status).map((group) => (
                    <div key={group.key}>
                      <span className="muted">{group.title}</span>
                      <strong>{group.items.length}</strong>
                    </div>
                  ))}
                </div>
              </RecordSection>
              {groupWork(customers, (c) => c.status).map((group) => (
                <RecordSection
                  key={group.key}
                  title={group.title}
                  description={group.description}
                  count={group.items.length}
                  className={`record-section-${group.key}`}
                >
                  <ul className="record-work-grid">
                    {group.items.map((c) => (
                      <li key={c.id}>
                        <SampleWork customer={c} />
                      </li>
                    ))}
                  </ul>
                </RecordSection>
              ))}
            </>
          ) : !who && view === "reports" ? (
            <>
              <h1>Reports</h1>
              <p className="muted">
                Operational and financial performance, separate from job
                payments.
              </p>
              <RecordSection
                title="Business performance"
                description="Illustrative report data. The authenticated Reports tab uses real shop data."
              >
                <div className="record-summary-grid">
                  {[
                    ["Appointments", "4 scheduled"],
                    ["Work", "8 ROs opened"],
                    ["Customers", "6 new"],
                    ["Revenue", "$6,800 collected"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span className="muted">{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </RecordSection>
            </>
          ) : !who ? (
            <>
              <div className="customer-list-heading">
                <div>
                  <h1>Customers</h1>
                  <p className="muted">
                    Contact details, vehicles and work history in each record.
                  </p>
                </div>
                <Link className="btn primary" href="/demo/customer/new">
                  + Customer
                </Link>
              </div>
              <RecordSection
                title="Find a customer"
                className="record-page-tools"
              >
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
              </RecordSection>
              {!search && <RecentCustomers scope="public-demo" demo />}
              <RecordSection
                title="Customer directory"
                count={filtered.length}
                description="Sample customers"
                actions={
                  <Link href="/demo/job" className="crm-sample-pricing-link">
                    Try job setup & pricing →
                  </Link>
                }
              >
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
              </RecordSection>
            </>
          ) : (
            <>
              <RememberCustomer
                id={who.id}
                name={who.name}
                scope="public-demo"
              />
              <Link href="/demo/crm" className="crm-sample-back">
                ← Customers
              </Link>
              <header className="customer-hero">
                <CustomerContactActions
                  phone={`+1${who.contact.replace(/\D/g, "")}`}
                  email={who.email}
                />
                <div className="customer-hero-main">
                  <div className="customer-hero-avatar" aria-hidden="true">
                    {who.name.charAt(0)}
                  </div>
                  <div className="customer-hero-identity">
                    <p className="customer-eyebrow">Customer record</p>
                    <h1>{who.name}</h1>
                    <CustomerContactSummary
                      phone={who.contact}
                      email={who.email}
                      address={who.address}
                    />
                    <p className="muted customer-hero-asset">{who.asset}</p>
                  </div>
                </div>
                <div
                  className="customer-hero-actions"
                  aria-label="Customer work actions"
                >
                  <Link
                    className="btn primary"
                    href={`/demo/job?customer=${who.id}`}
                  >
                    + New RO
                  </Link>
                  <Link
                    className="btn secondary"
                    href={`/demo/appointment?customer=${who.id}`}
                  >
                    + Appointment
                  </Link>
                </div>
              </header>
              <div className="profile-layout customer-profile-layout">
                <aside className="customer-profile-side">
                  <RecordSection title="Account summary">
                    <dl className="record-facts">
                      <div>
                        <dt>Outstanding</dt>
                        <dd>{who.status === "paid" ? "$0.00" : "$1,188.57"}</dd>
                      </div>
                      <div>
                        <dt>Lifetime payments</dt>
                        <dd>$4,750.00</dd>
                      </div>
                    </dl>
                    <Link href={`${url}&tab=Details`} className="btn secondary">
                      Customer options
                    </Link>
                  </RecordSection>
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
                    <>
                      <RecordSection
                        title="Active ROs"
                        count={who.status === "paid" ? 0 : 1}
                        description="Current work for this customer."
                        actions={
                          <Link href={`${url}&tab=Jobs`}>RO history</Link>
                        }
                        className="record-section-active"
                      >
                        {who.status === "paid" ? (
                          <p className="muted">
                            No active work. Previous ROs are in their work
                            history.
                          </p>
                        ) : (
                          <div className="record-work-grid">
                            <SampleWork customer={who} profile />
                          </div>
                        )}
                      </RecordSection>
                      <div className="record-two-column">
                        <RecordSection
                          title="Vehicles"
                          count={1}
                          actions={
                            <Link href={`${url}&tab=Vehicles`}>View all</Link>
                          }
                        >
                          <article className="record-information-card">
                            <strong>{who.asset}</strong>
                            <span className="muted">Vehicle on file</span>
                          </article>
                        </RecordSection>
                        <RecordSection
                          title="Recent activity"
                          actions={
                            <Link href={`${url}&tab=History`}>History</Link>
                          }
                        >
                          <ul className="record-timeline">
                            <li>
                              <strong>Estimate prepared</strong>
                              <span className="muted">Today</span>
                            </li>
                            <li>
                              <strong>Customer called</strong>
                              <span className="muted">Yesterday</span>
                            </li>
                          </ul>
                        </RecordSection>
                      </div>
                    </>
                  ) : activeTab === "Jobs" ? (
                    <>
                      <div className="section-heading">
                        <h2>Repair order history</h2>
                      </div>
                      {groupWork([who], (c) => c.status)
                        .filter((group) => group.items.length)
                        .map((group) => (
                          <RecordSection
                            key={group.key}
                            title={group.title}
                            count={group.items.length}
                            description={group.description}
                            className={`record-section-${group.key}`}
                          >
                            <div className="record-work-grid">
                              <SampleWork customer={who} profile />
                            </div>
                          </RecordSection>
                        ))}
                    </>
                  ) : activeTab === "Vehicles" ? (
                    <RecordSection title="Vehicles" count={1}>
                      <article className="record-information-card">
                        <strong>{who.asset}</strong>
                        <span className="muted">
                          Vehicle on file for {who.name}
                        </span>
                      </article>
                    </RecordSection>
                  ) : activeTab === "History" ? (
                    <RecordSection
                      title="Customer history"
                      description="The record of calls, appointments and work."
                    >
                      <ul className="record-timeline">
                        <li>
                          <strong>Estimate prepared</strong>
                          <span className="muted">Today</span>
                        </li>
                        <li>
                          <strong>Customer called</strong>
                          <span className="muted">Yesterday</span>
                        </li>
                      </ul>
                    </RecordSection>
                  ) : (
                    <RecordSection title="Customer preferences">
                      <p>Contact details and communication preferences</p>
                      <dl className="record-facts">
                        <div>
                          <dt>Customer</dt>
                          <dd>{who.name}</dd>
                        </div>
                        <div>
                          <dt>Email</dt>
                          <dd>{who.email}</dd>
                        </div>
                        <div>
                          <dt>Mobile</dt>
                          <dd>{who.contact}</dd>
                        </div>
                        <div>
                          <dt>Address</dt>
                          <dd>{who.address}</dd>
                        </div>
                      </dl>
                    </RecordSection>
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
        {destinations.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.mobile}
            aria-current={item.current ? "page" : undefined}
          >
            <WorkspaceIcon name={item.icon} />
            <span>{item.mobile}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
