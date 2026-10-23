import { redirect } from "next/navigation";
import { getInternalUser, type InternalUser } from "../auth/session";

export async function requireInternal(role?: "admin"): Promise<InternalUser> {
  const u = await getInternalUser();
  if (!u) redirect("/admin/sign-in");
  if (role === "admin" && u.role !== "admin") redirect("/admin?denied=1");
  return u;
}
