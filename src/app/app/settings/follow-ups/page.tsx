import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { HydratedMain } from "@/components/hydrated-main";
import { withTenant } from "@/db/tenant";
import { loadFollowUpRules } from "@/domain/money-finder";
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
};

export default async function FollowUpRulesPage() {
  const s = await requireOwnerView("/app/settings/follow-ups");
  const rules = await withTenant(s.businessId, s.actor, (tx) =>
    loadFollowUpRules(tx),
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
    </HydratedMain>
  );
}
