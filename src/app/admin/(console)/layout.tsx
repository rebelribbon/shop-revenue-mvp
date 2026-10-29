import Link from "next/link";
import { requireInternal } from "@/server/views/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireInternal();
  return (
    <>
      <header className="topbar">
        <strong>Admin · {me.displayName} ({me.role})</strong>
        <nav aria-label="Admin">
          <Link href="/admin/release">Release readiness</Link>
          <Link href="/admin">Tenants</Link>
          {me.role === "admin" && <Link href="/admin/policies">Legal policies</Link>}
          {me.role === "admin" && <Link href="/admin/webhooks">Webhooks</Link>}
          <form action="/auth/sign-out" method="post" style={{ display: "inline" }}>
            <button className="btn secondary" style={{ marginTop: 0, minHeight: 32, padding: "2px 10px" }}>Sign out</button>
          </form>
        </nav>
      </header>
      {children}
    </>
  );
}

