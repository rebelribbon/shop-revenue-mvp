// Page-level session guard for the shop app (Section 4 shared rules: a route the
// user may not use returns the shop's Money screen with a toast).
import { redirect } from "next/navigation";
import { getSessionState, type ShopSession } from "../auth/session";

export async function requireShopSession(path: string): Promise<ShopSession> {
  const state = await getSessionState();
  if (state.kind === "anonymous") redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  if (state.kind === "no_access") redirect("/no-access");
  return state.session;
}

export async function requireOwnerView(path: string): Promise<ShopSession> {
  const s = await requireShopSession(path);
  // Support view-as may read what the owner sees; Staff may not.
  if (s.role === "staff") redirect("/app?denied=1");
  return s;
}
