import { AdminNavigation } from "@/components/workspace-navigation";
import { requireInternal } from "@/server/views/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireInternal();
  return (
    <>
      <header className="topbar">
        <strong>
          Admin · {me.displayName} ({me.role})
        </strong>
        <AdminNavigation isAdmin={me.role === "admin"} />
      </header>
      {children}
      <AdminNavigation isAdmin={me.role === "admin"} mobile />
    </>
  );
}
