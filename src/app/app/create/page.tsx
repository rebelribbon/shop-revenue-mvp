import Link from "next/link";
import { HydratedMain } from "@/components/hydrated-main";
import { requireShopSession } from "@/server/views/shop";

// "+ New": everything you can add, one tap each.
export default async function CreatePage() {
  const s = await requireShopSession("/app/create");
  const items = [
    ["/app/jobs?new=1", "Job", "Parts, labor and an estimate"],
    ["/app/customers/new", "Customer", "Name, phone and vehicle or address"],
    ["/app/schedule?new=1", "Visit", "Book a time on the calendar"],
    ["/app/tasks?add=1", "Task", "A reminder for you or the shop"],
    ...(s.role === "owner"
      ? [
          [
            "/app/money?new=1#expense-form",
            "Expense",
            "Rent, parts, tools, anything you paid",
          ],
        ]
      : []),
  ] as const;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Add something new</h1>
      <div className="create-grid">
        {items.map(([href, title, detail], n) => (
          <Link
            key={href}
            href={href}
            className="card create-tile"
            {...(n === 0 ? { "data-page-primary": true } : {})}
          >
            <strong>{title}</strong>
            <span className="muted">{detail}</span>
          </Link>
        ))}
      </div>
    </HydratedMain>
  );
}
