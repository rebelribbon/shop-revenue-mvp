// Edge of every request (Next.js 16 "proxy", Node runtime): request ID for
// tracing (Section 20), Supabase session cookie refresh, security headers, and
// no-store/noindex on token routes (Section 16).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const TOKEN_ROUTES = /^\/(e|i|r|invite)\//;

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  let response = NextResponse.next({ request: { headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isWebhook = request.nextUrl.pathname.startsWith("/webhooks/") || request.nextUrl.pathname.startsWith("/api/");
  if (url && anon && !isWebhook) {
    const secure = !["local", "test"].includes(process.env.APP_ENV ?? "local");
    const supabase = createServerClient(url, anon, {
      cookieOptions: { httpOnly: true, secure, sameSite: "lax", path: "/" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const c of list) request.cookies.set(c.name, c.value);
          response = NextResponse.next({ request: { headers } });
          for (const c of list) response.cookies.set(c.name, c.value, { ...c.options, httpOnly: true, secure, sameSite: "lax" });
        },
      },
    });
    // Refreshes an expiring session; authorization itself happens server-side per request.
    await supabase.auth.getUser();
  }

  response.headers.set("x-request-id", requestId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (TOKEN_ROUTES.test(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
