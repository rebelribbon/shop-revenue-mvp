import { isAutomotive } from "@/lib/business-types";
import Link from "next/link";

export function WorkNavigation({
  current,
  businessType = "automotive",
}: {
  current: "jobs" | "estimates" | "invoices";
  businessType?: string;
}) {
  return (
    <nav className="section-tabs" aria-label="Work stages">
      {(
        [
          ["jobs", isAutomotive(businessType) ? "Repairs" : "Jobs"],
          ["estimates", "Estimates"],
          ["invoices", "Invoices"],
        ] as const
      ).map(([key, label]) => (
        <Link
          key={key}
          href={`/app/${key}`}
          aria-current={current === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
