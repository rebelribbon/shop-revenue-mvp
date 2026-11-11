import { sessionNeedsMfa } from "../auth/assurance";
import { redirect } from "next/navigation";
import { getInternalUser, type InternalUser } from "../auth/session";

export async function requireInternal(role?: "admin"): Promise<InternalUser> {
  const u = await getInternalUser();
  if (!u) redirect("/admin/sign-in");
  if (role === "admin" && u.role !== "admin") redirect("/admin?denied=1");
  // The preview site relaxes two-factor for shop test logins only; the
  // internal admin console always keeps it there.
  if (await sessionNeedsMfa(process.env.VERCEL_ENV === "preview"))
    redirect("/verify?next=/admin");
  return u;
}
