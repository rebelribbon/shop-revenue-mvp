"use client";
import Link from "next/link";
import { WorkspaceIcon } from "./workspace-icon";
import { usePathname } from "next/navigation";
const shopItems = [
  { href: "/app/schedule", label: "Appointments", mobile: "Appts", icon: "calendar", phone: true },
  { href: "/app/tasks", label: "Tasks", mobile: "Tasks", icon: "tasks", phone: true },
  { href: "/app/customers", label: "Customers", mobile: "Customers", icon: "customers", phone: true },
  { href: "/app/jobs", label: "Jobs / ROs", mobile: "Jobs", icon: "work", phone: true },
  { href: "/app/money", label: "Reports", mobile: "Reports", icon: "money", phone: true },
] as const;
const workPaths = ["/app/jobs", "/app/work", "/app/estimates", "/app/invoices"];
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
        .filter((item) => canSeeMoney || item.href !== "/app/money")
        .filter((item) => !mobile || item.phone)
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={
              (
                item.href === "/app"
                  ? path === item.href || path.startsWith("/app/schedule")
                  : path.startsWith(item.href) ||
                    (item.href === "/app/tasks" &&
                      path.startsWith("/app/opportunities")) ||
                    (item.href === "/app/money" &&
                      path.startsWith("/app/revenue")) ||
                    (item.href === "/app/jobs" &&
                      workPaths.some((p) => path.startsWith(p)))
              )
                ? "page"
                : undefined
            }
          >
            {!mobile && <WorkspaceIcon name={item.icon} />}
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
