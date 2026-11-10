import Link from "next/link";
export function TasksNavigation({
  current,
  technicianOnly = false,
}: {
  current: "due" | "later" | "all";
  technicianOnly?: boolean;
}) {
  return (
    <nav
      className="section-tabs"
      aria-label="Task lists"
      data-technician-nav={technicianOnly || undefined}
    >
      {[
        ["due", "/app/tasks", "To do"],
        ["later", "/app/tasks?view=later", "Coming up"],
        ["all", "/app/opportunities", "All follow-ups"],
      ]
        .filter(([key]) => !technicianOnly || key !== "all")
        .map(([key, href, label]) => (
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
