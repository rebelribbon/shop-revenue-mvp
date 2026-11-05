import { publicSignupEnabled } from "@/lib/billing";
import { redirect } from "next/navigation";
import { getSessionState } from "@/server/auth/session";

export default async function Home() {
  const state = await getSessionState();
  redirect(
    state.kind === "shop"
      ? "/app"
      : state.kind === "no_access"
        ? "/no-access"
        : publicSignupEnabled()
          ? "/pricing"
          : "/sign-in",
  );
}
