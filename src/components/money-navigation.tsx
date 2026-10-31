import Link from "next/link";
export function MoneyNavigation({
  current,
}: {
  current: "overview" | "followups" | "sales";
}) {
  return (
    <nav className="section-tabs" aria-label="Money pages">
      {[
        ["overview", "/app/money", "Overview"],
        ["followups", "/app/opportunities", "Follow-ups"],
        ["sales", "/app/revenue", "Follow-up sales"],
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
