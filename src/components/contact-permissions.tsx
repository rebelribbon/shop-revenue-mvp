import { ActionForm } from "./action-form";
import { setContactPermissionAction } from "@/server/actions/customers";
import { setDoNotContactAction } from "@/server/actions/money-finder";

type Props = {
  customerId: string;
  hasPhone: boolean;
  hasEmail: boolean;
  textOptedOutAt: Date | null;
  emailOptedOutAt: Date | null;
  doNotContact: boolean;
  timeZone: string;
  canEdit: boolean;
};

const day = (d: Date, timeZone: string) =>
  d.toLocaleDateString("en-US", { timeZone, dateStyle: "medium" });

// One place to record what the customer agreed to. Texts and emails go out
// from the owner's own phone and email, so a STOP reply lands there: tapping
// the button here is how the app learns about it and hides those options.
export function ContactPermissions(p: Props) {
  const rows = [
    {
      channel: "text" as const,
      label: "Texts",
      has: p.hasPhone,
      stoppedAt: p.textOptedOutAt,
      stopLabel: "Customer said STOP",
      startLabel: "Customer asked to get texts again",
    },
    {
      channel: "email" as const,
      label: "Emails",
      has: p.hasEmail,
      stoppedAt: p.emailOptedOutAt,
      stopLabel: "Customer unsubscribed",
      startLabel: "Customer asked to get emails again",
    },
  ];
  return (
    <section className="card" aria-labelledby="contact-permissions">
      <h2 id="contact-permissions">Texts & emails</h2>
      {rows.map((r) => (
        <div className="overview-row" key={r.channel}>
          <div>
            <strong>{r.label}: </strong>
            {r.stoppedAt ? (
              <span>
                Stopped {day(r.stoppedAt, p.timeZone)}. You can’t send{" "}
                {r.label.toLowerCase()} from the app.
              </span>
            ) : r.has ? (
              <span>Allowed</span>
            ) : (
              <span className="muted">
                No {r.channel === "text" ? "mobile number" : "email"} on file
              </span>
            )}
          </div>
          {p.canEdit && (r.has || r.stoppedAt) && (
            <ActionForm
              action={setContactPermissionAction}
              hidden={{
                customerId: p.customerId,
                channel: r.channel,
                allowed: r.stoppedAt ? "true" : "false",
              }}
              submitLabel={r.stoppedAt ? r.startLabel : r.stopLabel}
              variant={r.stoppedAt ? "secondary" : "danger"}
            />
          )}
        </div>
      ))}
      <div className="overview-row">
        <div>
          <strong>Follow-up reminders: </strong>
          {p.doNotContact
            ? "Off — this customer won’t appear in Follow-ups."
            : "On — this customer can appear in Follow-ups."}
        </div>
        {p.canEdit && (
          <ActionForm
            action={setDoNotContactAction}
            hidden={{
              customerId: p.customerId,
              value: p.doNotContact ? "false" : "true",
            }}
            submitLabel={
              p.doNotContact ? "Turn follow-ups back on" : "No follow-ups"
            }
            variant="secondary"
          />
        )}
      </div>
      <p className="muted">
        When a customer replies STOP, unsubscribes, or asks you to stop, tap the
        matching button the same day. The law gives you at most 10 business
        days.
      </p>
    </section>
  );
}
