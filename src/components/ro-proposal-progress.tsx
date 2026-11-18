const stages = [
  { key: "price", label: "Price" },
  { key: "review", label: "Review" },
  { key: "send", label: "Send" },
  { key: "track", label: "Track" },
] as const;

type Stage = (typeof stages)[number]["key"];

/** Compact orientation without another giant card or duplicate CTA. */
export function RoProposalProgress({
  stage,
  note,
}: {
  stage: Stage;
  note?: string;
}) {
  const current = stages.findIndex((item) => item.key === stage);
  return (
    <div
      className="ro-proposal-progress"
      aria-label="Customer proposal progress"
    >
      <div className="ro-proposal-progress-header">
        <strong>Customer proposal</strong>
        <span>
          Step {current + 1} of {stages.length}
        </span>
      </div>
      <ol>
        {stages.map((item, index) => (
          <li
            key={item.key}
            aria-current={index === current ? "step" : undefined}
          >
            <span
              className={
                index < current
                  ? "is-complete"
                  : index === current
                    ? "is-current"
                    : ""
              }
              aria-hidden="true"
            />
            <small>{item.label}</small>
          </li>
        ))}
      </ol>
      {note && <p className="muted">{note}</p>}
    </div>
  );
}
