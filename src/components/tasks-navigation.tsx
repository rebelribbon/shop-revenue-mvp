import Link from "next/link";
export function TasksNavigation({
  current,
}: {
  current: "due" | "later" | "all";
}) {
  return (
    <nav className="section-tabs" aria-label="Task lists">
      {[
        ["due", "/app/tasks", "To do"],
        ["later", "/app/tasks?view=later", "Coming up"],
        ["all", "/app/opportunities", "All follow-ups"],
      ].map(([key, href, label]) => (
        <Link
          key={key}
          href={href}
          aria-current={current === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
