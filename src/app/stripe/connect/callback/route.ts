import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { finishStripeConnection } from "@/domain/stripe-connect";
import { paymentBaseUrl, safeStripeError } from "@/lib/stripe";
import {
  stripeConnectCookieName,
  stripeConnectCookieOptions,
  validStripeConnectState,
} from "@/lib/stripe-connect";
import { getSessionState } from "@/server/auth/session";
import { sessionNeedsMfa } from "@/server/auth/assurance";
import { getRequestMeta } from "@/server/request";
import { toActionError } from "@/server/actions/define";

const settings = "/app/settings/payments";
function redirect(path: string) {
  const response = NextResponse.redirect(new URL(path, paymentBaseUrl()), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  const meta = await getRequestMeta();
  const jar = await cookies();
  let clearCookie = false;
  let response: NextResponse;
  try {
    const session = await getSessionState();
    if (session.kind === "anonymous")
      return redirect(`/sign-in?next=${encodeURIComponent(settings)}`);
    if (session.kind !== "shop") return redirect("/no-access");
    if (
      session.session.role !== "owner" ||
      session.session.actor.type !== "user"
    )
      return redirect("/app?denied=1");
    if (await sessionNeedsMfa())
      return redirect(`/verify?next=${encodeURIComponent(settings)}`);

    const params = new URL(request.url).searchParams;
    const state = params.get("state") ?? "";
    if (
      params.getAll("state").length !== 1 ||
      !validStripeConnectState(
        state,
        jar.get(stripeConnectCookieName())?.value ?? "",
      )
    )
      return redirect(`${settings}?stripe=expired`);
    // Only a matching callback may clear the cookie; forged requests cannot
    // invalidate a different connection attempt in progress.
    clearCookie = true;
    const code = params.get("code");
    const canceled = params.get("error") === "access_denied";
    if (
      params.getAll("code").length > 1 ||
      (code && params.has("error")) ||
      (!code && !canceled)
    )
      throw new Error("Invalid Stripe callback");
    const result = await finishStripeConnection(
      session.session,
      meta,
      state,
      code,
    );
    response = redirect(
      `${settings}?stripe=${result.canceled ? "canceled" : result.active ? "connected" : "pending"}`,
    );
  } catch (error) {
    toActionError(safeStripeError(error), meta, "stripeConnectCallback");
    response = redirect(`${settings}?stripe=error`);
  }
  if (clearCookie)
    response.cookies.set(stripeConnectCookieName(), "", {
      ...stripeConnectCookieOptions(),
      maxAge: 0,
    });
  return response;
}
