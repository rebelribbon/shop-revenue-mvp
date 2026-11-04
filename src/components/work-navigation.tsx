import Link from "next/link";
import { isAutomotive } from "@/lib/business-types";

export function WorkNavigation({
  current,
  businessType = "automotive",
}: {
  current: "jobs" | "estimates" | "invoices" | "parts";
  businessType?: string;
}) {
  return (
    <nav className="section-tabs" aria-label="Work stages">
      {(
        [
          ["jobs", "Jobs"],
          ["estimates", "Estimates"],
          ["invoices", "Invoices"],
          ["parts", isAutomotive(businessType) ? "Parts" : "Materials"],
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
