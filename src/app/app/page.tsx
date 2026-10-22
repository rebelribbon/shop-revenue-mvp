import { requireShopSession } from "@/server/views/shop";

export default async function MoneyHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const s = await requireShopSession("/app");
  const { denied } = await searchParams;
  return (
    <main>
      {denied && <p role="status" className="notice error">Only the owner can open that page.</p>}
      <h1>Money</h1>
      <div className="card">
        <p>You&rsquo;re signed in as {s.role === "support" ? "support (view-as)" : s.role}.</p>
        <p className="muted">Your setup checklist and Money Finder appear here as they are built. Nothing on this screen is estimated or placeholder data.</p>
      </div>
    </main>
  );
}
