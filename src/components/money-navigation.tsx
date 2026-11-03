import Link from "next/link";
export function MoneyNavigation({
  current,
}: {
  current: "overview" | "sales" | "reports";
}) {
  return (
    <nav className="section-tabs" aria-label="Money pages">
      {[
        ["overview", "/app/money", "Overview"],
        ["sales", "/app/revenue", "Won from follow-ups"],
        ["reports", "/app/money/reports", "Reports"],
      ].map(([key, path, label]) => (
        <Link
          key={key}
          href={path}
          aria-current={current === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
