"use client";
import Link from "next/link";
import { WorkspaceIcon } from "./workspace-icon";
import { usePathname } from "next/navigation";
const shopItems = [
  { href: "/app/schedule", label: "Appointments", mobile: "Appts", icon: "schedule", phone: true },
  { href: "/app/tasks", label: "Tasks", mobile: "Tasks", icon: "tasks", phone: true },
  { href: "/app/customers", label: "Customers", mobile: "Customers", icon: "customers", phone: true },
  { href: "/app/jobs", label: "Jobs / ROs", mobile: "Jobs", icon: "work", phone: true },
  { href: "/app/reports", label: "Reports", mobile: "Reports", icon: "reports", phone: true },
] as const;
const workPaths = ["/app/work", "/app/estimates", "/app/invoices"];
export function WorkspaceNavigation({
  mobile = false,
  canSeeMoney = true,
  counts = {},
}: {
  mobile?: boolean;
  canSeeMoney?: boolean;
  counts?: Record<string, number>;
}) {
  const path = usePathname();
  return (
    <nav
      className={
        mobile ? "mobile-nav shop-mobile-nav" : "desktop-nav workspace-nav"
      }
      aria-label={mobile ? "Mobile navigation" : "Main"}
    >
      {shopItems
        .filter((item) => canSeeMoney || item.href !== "/app/reports")
        .filter((item) => !mobile || item.phone)
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={
              (
                item.href === "/app/schedule"
                  ? path.startsWith("/app/schedule") || path.startsWith("/app/appointments")
                  : path.startsWith(item.href) ||
                    (item.href === "/app/tasks" &&
                      path.startsWith("/app/opportunities")) ||
                    (item.href === "/app/reports" &&
                      (path.startsWith("/app/money/reports") || path.startsWith("/app/revenue"))) ||
                    (item.href === "/app/jobs" &&
                      workPaths.some((p) => path.startsWith(p)))
              )
                ? "page"
                : undefined
            }
          >
            <WorkspaceIcon name={item.icon} />
            <span>{mobile ? item.mobile : item.label}</span>
            {!mobile && (counts[item.href] ?? 0) > 0 && (
              <span
                className="nav-count"
                aria-label={`${counts[item.href]} due`}
              >
                {counts[item.href]}
              </span>
            )}
          </Link>
        ))}
    </nav>
  );
}
export function AdminNavigation({
  isAdmin,
  mobile = false,
}: {
  isAdmin: boolean;
  mobile?: boolean;
}) {
  const path = usePathname();
  const items = [
    { href: "/admin", label: "Tenants" },
    { href: "/admin/release", label: "Readiness" },
    ...(isAdmin
      ? [
          { href: "/admin/policies", label: "Policies" },
          { href: "/admin/webhooks", label: "Webhooks" },
        ]
      : []),
    { href: "/admin/help", label: "Help" },
  ];
  return (
    <nav
      className={mobile ? "mobile-nav admin-mobile-nav" : "desktop-nav"}
      aria-label={mobile ? "Admin mobile navigation" : "Admin"}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-label={item.label}
          aria-current={
            (
              item.href === "/admin"
                ? path === "/admin" || path.startsWith("/admin/tenants/")
                : path.startsWith(item.href)
            )
              ? "page"
              : undefined
          }
        >
          {mobile
            ? item.label === "Readiness"
              ? "Check"
              : item.label === "Webhooks"
                ? "Hooks"
                : item.label === "Tenants"
                  ? "Orgs"
                  : item.label === "Policies"
                    ? "Rules"
                    : item.label
            : item.label}
        </Link>
      ))}
    </nav>
  );
}
