import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { HydratedMain } from "@/components/hydrated-main";
import { withTenant } from "@/db/tenant";
import { loadFollowUpRules } from "@/domain/money-finder";
import { readReminderSettings } from "@/domain/payment-reminders";
import { saveReminderSettingsAction } from "@/server/actions/payment-reminders";
import { readReviewSettings } from "@/domain/review-requests";
import { saveReviewSettingsAction } from "@/server/actions/review-requests";
import { RULE_TEXT } from "@/lib/follow-up-rules";
import { saveFollowUpRulesAction } from "@/server/actions/tasks";
import { requireOwnerView } from "@/server/views/shop";

const MAX: Record<string, number> = {
  newLead: 60,
  estimate: 60,
  unpaid: 60,
  jobUpdate: 30,
  pastCustomer: 24,
  declined: 365,
  serviceDue: 90,
  confirmVisit: 7,
};

export default async function FollowUpRulesPage() {
  const s = await requireOwnerView("/app/settings/follow-ups");
  const [rules, reminders, reviews] = await withTenant(
    s.businessId,
    s.actor,
    (tx) =>
      Promise.all([
        loadFollowUpRules(tx),
        readReminderSettings(tx),
        readReviewSettings(tx),
      ]),
  );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p>
        <Link href="/app/settings">← Settings</Link>
      </p>
      <h1>Follow-up rules</h1>
      <p className="muted">
        Each rule puts a task on your list when it’s time to reach out. Mark it
        done and it comes back on the same schedule until the customer books or
        pays.
      </p>
      <ActionForm
        action={saveFollowUpRulesAction}
        submitLabel="Save follow-up rules"
        variant="primary"
      >
        {RULE_TEXT.map((r) => {
          const rule = rules[r.key] as Record<string, number | boolean>;
          return (
            <fieldset className="rule-row" key={r.key}>
              <legend>{r.title}</legend>
              <label className="switch">
                <input
                  type="checkbox"
                  name={`${r.key}_on`}
                  defaultChecked={Boolean(rule.on)}
                />
                On
              </label>
              <label htmlFor={`rule-${r.key}`}>{r.before}</label>
              <div className="rule-amount">
                <input
                  id={`rule-${r.key}`}
                  name={`${r.key}_n`}
                  type="number"
                  inputMode="numeric"
                  min={r.key === "declined" ? 0 : 1}
                  max={MAX[r.key]}
                  step={1}
                  required
                  defaultValue={Number(rule[r.field])}
                />
                <span>{r.unit}</span>
              </div>
            </fieldset>
          );
        })}
      </ActionForm>
      <section
        className="card reminder-settings"
        aria-label="Automatic payment reminders"
      >
        <h2>Automatic payment reminders</h2>
        <p className="muted">
          We email the customer their pay link once an invoice is due, then
          every few days until it’s paid (up to {5} times). Customers who opted
          out of email are skipped. Your unpaid-invoice call task still shows up
          either way.
        </p>
        <ActionForm
          action={saveReminderSettingsAction}
          submitLabel="Save reminders"
          variant="secondary"
        >
          <fieldset className="reminder-switch">
            <legend>Send reminders automatically</legend>
            <label>
              <input
                type="radio"
                name="on"
                value="true"
                defaultChecked={reminders.on}
              />
              On
            </label>
            <label>
              <input
                type="radio"
                name="on"
                value="false"
                defaultChecked={!reminders.on}
              />
              Off
            </label>
          </fieldset>
          <label htmlFor="reminder-days">Send one every</label>
          <div className="rule-amount">
            <input
              id="reminder-days"
              name="everyDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              step={1}
              required
              defaultValue={reminders.everyDays}
            />
            <span>days</span>
          </div>
        </ActionForm>
      </section>
      <section className="card reminder-settings" aria-label="Ask for reviews">
        <h2>Ask for reviews</h2>
        <p className="muted">
          When a customer pays in full, we email them your review link. Each
          customer is asked at most once every 6 months. You can also tap “Ask
          for a review” at checkout or on their profile.
        </p>
        <ActionForm
          action={saveReviewSettingsAction}
          submitLabel="Save review settings"
          variant="secondary"
        >
          <label htmlFor="review-link">Your review link</label>
          <input
            id="review-link"
            name="link"
            type="url"
            inputMode="url"
            maxLength={500}
            placeholder="https://g.page/r/…/review"
            defaultValue={reviews.link}
          />
          <p className="muted part-hint">
            In your Google Business Profile, tap “Ask for reviews” and copy the
            link.
          </p>
          <fieldset className="reminder-switch">
            <legend>Ask automatically after payment</legend>
            <label>
              <input
                type="radio"
                name="on"
                value="true"
                defaultChecked={reviews.on}
              />
              On
            </label>
            <label>
              <input
                type="radio"
                name="on"
                value="false"
                defaultChecked={!reviews.on}
              />
              Off
            </label>
          </fieldset>
        </ActionForm>
      </section>
    </HydratedMain>
  );
}
