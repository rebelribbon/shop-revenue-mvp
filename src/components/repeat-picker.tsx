"use client";
import {
  REPEAT_OPTIONS,
  cadenceText,
  formatPlanDate,
  formatPlanMoney,
  repeatValue,
  untilText,
  type Repeat,
} from "@/lib/service-plans";

const defaults = (today: string): Repeat => ({
  every: "week",
  startOn: today,
  time: null,
  until: { kind: "stopped" },
  billing: "per_visit",
});

// "One time | Repeats" with plain-English choices and a live summary of what
// the plan is worth to the shop.
export function RepeatPicker({
  value,
  onChange,
  today,
  perVisitCents,
  profitPerVisitCents,
}: {
  value: Repeat | null;
  onChange: (next: Repeat | null) => void;
  today: string;
  perVisitCents: number;
  profitPerVisitCents: number | null;
}) {
  const r = value;
  const set = (patch: Partial<Repeat>) =>
    onChange({ ...(r ?? defaults(today)), ...patch });
  const worth = r ? repeatValue(r, perVisitCents) : null;
  return (
    <section className="repeat-picker" aria-label="How often">
      <fieldset className="chips">
        <legend>How often is this job?</legend>
        <label>
          <input
            type="radio"
            name="repeat-mode"
            checked={!r}
            onChange={() => onChange(null)}
          />
          One time
        </label>
        <label>
          <input
            type="radio"
            name="repeat-mode"
            checked={!!r}
            onChange={() => onChange(r ?? defaults(today))}
          />
          Repeats
        </label>
      </fieldset>
      {r && (
        <>
          <fieldset className="chips">
            <legend>Repeats</legend>
            {REPEAT_OPTIONS.map((o) => (
              <label key={o.value}>
                <input
                  type="radio"
                  name="repeat-every"
                  checked={r.every === o.value}
                  onChange={() => set({ every: o.value })}
                />
                {o.label}
              </label>
            ))}
          </fieldset>
          <label>
            First visit
            <input
              type="date"
              required
              min={today}
              value={r.startOn}
              onChange={(e) =>
                e.target.value && set({ startOn: e.target.value })
              }
            />
          </label>
          <label>
            Usual time (optional)
            <input
              type="time"
              step={900}
              value={r.time ?? ""}
              onChange={(e) => set({ time: e.target.value || null })}
            />
          </label>
          <fieldset className="chips">
            <legend>Keep going</legend>
            <label>
              <input
                type="radio"
                name="repeat-until"
                checked={r.until.kind === "stopped"}
                onChange={() => set({ until: { kind: "stopped" } })}
              />
              Until I stop it
            </label>
            <label>
              <input
                type="radio"
                name="repeat-until"
                checked={r.until.kind === "date"}
                onChange={() =>
                  set({
                    until: {
                      kind: "date",
                      on:
                        r.until.kind === "date"
                          ? r.until.on
                          : `${Number(r.startOn.slice(0, 4))}-12-31`,
                    },
                  })
                }
              />
              Until a date
            </label>
            <label>
              <input
                type="radio"
                name="repeat-until"
                checked={r.until.kind === "visits"}
                onChange={() =>
                  set({
                    until: {
                      kind: "visits",
                      count: r.until.kind === "visits" ? r.until.count : 10,
                    },
                  })
                }
              />
              For a number of visits
            </label>
          </fieldset>
          {r.until.kind === "date" && (
            <label>
              Last visit on or before
              <input
                type="date"
                required
                min={r.startOn}
                value={r.until.on}
                onChange={(e) =>
                  e.target.value &&
                  set({ until: { kind: "date", on: e.target.value } })
                }
              />
            </label>
          )}
          {r.until.kind === "visits" && (
            <label>
              Number of visits
              <input
                type="number"
                min={1}
                max={520}
                step={1}
                required
                value={r.until.count}
                onChange={(e) =>
                  set({
                    until: {
                      kind: "visits",
                      count: Math.max(
                        1,
                        Math.min(520, Math.round(Number(e.target.value) || 1)),
                      ),
                    },
                  })
                }
              />
            </label>
          )}
          <fieldset className="chips">
            <legend>Bill the customer</legend>
            <label>
              <input
                type="radio"
                name="repeat-billing"
                checked={r.billing === "per_visit"}
                onChange={() => set({ billing: "per_visit" })}
              />
              After each visit
            </label>
            <label>
              <input
                type="radio"
                name="repeat-billing"
                checked={r.billing === "monthly"}
                onChange={() => set({ billing: "monthly" })}
              />
              Once a month
            </label>
          </fieldset>
          <div className="plan-summary" role="status" aria-live="polite">
            <p>
              <strong>{cadenceText(r)}</strong>, starting{" "}
              {formatPlanDate(r.startOn)}, {untilText(r)}.
            </p>
            {perVisitCents > 0 ? (
              <ul>
                <li>
                  {formatPlanMoney(perVisitCents)} a visit ≈{" "}
                  <strong>
                    {formatPlanMoney(worth!.monthlyCents)} a month
                  </strong>
                </li>
                {worth!.totalCents !== null ? (
                  <li>
                    {worth!.visits} visits ={" "}
                    <strong>{formatPlanMoney(worth!.totalCents)}</strong> for
                    the whole plan
                  </li>
                ) : (
                  <li>
                    About{" "}
                    <strong>
                      {formatPlanMoney(worth!.yearlyCents)} a year
                    </strong>{" "}
                    of steady work
                  </li>
                )}
                {profitPerVisitCents !== null && (
                  <li>
                    You keep about {formatPlanMoney(profitPerVisitCents)} a
                    visit after costs
                  </li>
                )}
              </ul>
            ) : (
              <p className="muted">
                Add the work below to see what this plan is worth.
              </p>
            )}
            <p className="muted">
              The customer signs once. Visits go on your calendar after they
              approve, and you can skip, pause or stop anytime.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
