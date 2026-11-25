import Link from "next/link";
import { HydratedMain } from "@/components/hydrated-main";
import { confirmAccountLink } from "@/server/actions/auth";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function ConfirmLink({ searchParams }: {
  searchParams: Promise<{ token_hash?: string; type?: string; redirect_to?: string }>;
}) {
  const p = await searchParams;
  const valid = typeof p.token_hash === "string" && /^[a-zA-Z0-9_-]{20,512}$/.test(p.token_hash) &&
    (p.type === "recovery" || p.type === "email");
  let next = "";
  // Preserve a staff invitation's post-reset destination, but not arbitrary redirects.
  if (p.type === "recovery" && typeof p.redirect_to === "string") {
    try {
      const u = new URL(p.redirect_to);
      if (u.origin === new URL(process.env.APP_BASE_URL!).origin && u.pathname === "/auth/callback")
        next = u.searchParams.get("next") ?? "";
    } catch { /* Invalid destination falls back to password recovery. */ }
  }
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>{p.type === "recovery" ? "Reset your password" : "Confirm your email"}</h1>
      {valid ? <form className="card" action={confirmAccountLink}>
        <p>You can continue on this device, even if you requested the email somewhere else.</p>
        <input type="hidden" name="token" value={p.token_hash} />
        <input type="hidden" name="type" value={p.type} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn primary">Continue</button>
      </form> : <p>This link is incomplete. Request a fresh email.</p>}
      <Link href={p.type === "recovery" ? "/forgot-password" : "/sign-up"}>Request a new email</Link>
    </HydratedMain>
  );
}
