import Link from "next/link";
import { redirect } from "next/navigation";
import {
  publicSignupEnabled,
  TRIAL_DAYS,
  MONTHLY_PRICE_CENTS,
} from "@/lib/billing";
import { subscriptionPriceLabel } from "@/domain/billing";
import { getSessionState } from "@/server/auth/session";
import styles from "./marketing.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shop Revenue | Run your service business in one place",
  description:
    "Manage customers, jobs, estimates, approvals, invoices and payments in one workspace for automotive repair and home service businesses.",
  robots: { index: false, follow: false },
};

const features = [
  [
    "01",
    "Customers & scheduling",
    "Keep customer details, service history, appointments and follow-up tasks organized.",
  ],
  [
    "02",
    "Jobs & inspections",
    "Assign work, document findings and keep your team on the same page.",
  ],
  [
    "03",
    "Estimates & approvals",
    "Send itemized recommendations so customers can review and authorize work from their phone.",
  ],
  [
    "04",
    "Invoices & payments",
    "Turn approved work into invoices and connect Stripe to accept customer payments.",
  ],
  [
    "05",
    "Revenue & reporting",
    "Track payments, expenses and opportunities to recover missed revenue.",
  ],
  [
    "06",
    "Team & permissions",
    "Give owners, advisors and technicians access appropriate to their responsibilities.",
  ],
];

export default async function Home() {
  const state = await getSessionState();
  if (state.kind === "shop") redirect("/app");
  if (state.kind === "no_access") redirect("/start");
  const price = await subscriptionPriceLabel();
  const open = publicSignupEnabled();
  const advertised = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(MONTHLY_PRICE_CENTS / 100);
  return (
    <main id="main-content" tabIndex={-1} className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <span aria-hidden="true">SR</span>Shop Revenue
        </Link>
        <nav aria-label="Website navigation">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>
      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>
            BUILT FOR INDEPENDENT SERVICE BUSINESSES
          </p>
          <h1>
            Run your business.
            <br />
            Not your paperwork.
          </h1>
          <p className={styles.lead}>
            From the first appointment to the final payment, keep your
            customers, team and revenue in one simple workspace.
          </p>
          <Link className={styles.primary} href="/sign-up">
            Create account
          </Link>
          <p className={styles.note}>
            {TRIAL_DAYS}-day free trial · {price ?? advertised + "/month"} ·
            Cancel anytime
          </p>
          {!open && (
            <p className={styles.note}>
              Early access signup is currently limited to invited owners.
            </p>
          )}
        </div>
        <div
          className={styles.preview}
          aria-label="Illustrative repair order workflow"
        >
          <div className={styles.previewTop}>
            <strong>Today&apos;s work</strong>
            <small>Illustrative workflow</small>
          </div>
          <div className={styles.previewStats}>
            <div>
              <small>Appointments</small>
              <strong>6</strong>
            </div>
            <div>
              <small>In progress</small>
              <strong>3</strong>
            </div>
            <div>
              <small>Ready to invoice</small>
              <strong>2</strong>
            </div>
          </div>
          {[
            "Customer checked in",
            "Inspection completed",
            "Estimate awaiting approval",
            "Work in progress",
            "Invoice & payment",
          ].map((label, i) => (
            <div className={styles.previewRow} key={label}>
              <span className={i < 2 ? styles.done : styles.dot}>
                {i < 2 ? "✓" : i + 1}
              </span>
              {label}
              <small>
                {i < 2 ? "Complete" : i === 2 ? "Next" : "Upcoming"}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section id="features" className={styles.section}>
        <p className={styles.kicker}>ONE WORKSPACE</p>
        <h2>Everything from check-in to checkout.</h2>
        <div className={styles.grid}>
          {features.map(([number, title, description]) => (
            <article key={number} className={styles.feature}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.section}>
        <h2>Designed around the work you do.</h2>
        <div className={styles.industries}>
          <article>
            <h3>Automotive repair</h3>
            <p>
              Vehicle history, repair orders, digital inspections, customer
              approvals and technician assignments.
            </p>
          </article>
          <article>
            <h3>Home services</h3>
            <p>
              Manage customer properties, service appointments, estimates, jobs
              and invoices for your trade.
            </p>
          </article>
        </div>
      </section>
      <section className={styles.section}>
        <p className={styles.kicker}>HOW IT WORKS</p>
        <h2>Three steps to a more organized business.</h2>
        <div className={styles.grid}>
          {[
            [
              "1",
              "Create your business",
              "Choose your industry and enter your business details.",
            ],
            [
              "2",
              "Manage the work",
              "Add customers, schedule visits, assign jobs and send estimates.",
            ],
            [
              "3",
              "Get paid",
              "Complete the job, send the invoice and track payments.",
            ],
          ].map(([n, t, d]) => (
            <article className={styles.feature} key={n}>
              <span>{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
      </section>
      <section id="pricing" className={styles.pricing}>
        <div>
          <p className={styles.kicker}>SIMPLE PRICING</p>
          <h2>One subscription per business.</h2>
          <p>
            Start with a {TRIAL_DAYS}-day free trial. Review your subscription
            and any promotional code at checkout.
          </p>
        </div>
        <article className={styles.priceCard}>
          <p>Shop Revenue monthly plan</p>
          <h3>{price ?? advertised + "/month"}</h3>
          {!price && (
            <p className={styles.note}>
              Advertised price; confirm the actual amount at checkout.
            </p>
          )}
          <p>Owner access plus up to 10 staff and technician logins.</p>
          <ul>
            <li>Core CRM and job management</li>
            <li>Estimates, approvals and invoices</li>
            <li>Reporting and customer payment integration</li>
          </ul>
          <Link className={styles.primary} href="/sign-up">
            Create account
          </Link>
          <p className={styles.note}>
            Card required to start trial. Cancel before the trial ends to avoid
            subscription charges. Payment processing fees are separate.
          </p>
        </article>
      </section>
      <footer className={styles.footer}>
        <strong>Shop Revenue</strong>
        <span>Built for small service businesses.</span>
        <Link href="/sign-in">Sign in</Link>
      </footer>
    </main>
  );
}
