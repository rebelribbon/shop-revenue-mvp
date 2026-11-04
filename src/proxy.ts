// Edge of every request (Next.js 16 "proxy", Node runtime): request ID for
// tracing (Section 20), Supabase session cookie refresh, security headers, and
// no-store/noindex on token routes (Section 16).
import { checkPublicThrottle } from "@/domain/public-throttle";
import { AppError } from "@/lib/errors";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const TOKEN_ROUTES =
  /^\/(e|i|r|invite|estimate|invoice|payment-return|sign|book|c)\//;

export async function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  let response = NextResponse.next({ request: { headers } });
  const document = request.nextUrl.pathname.match(
    /^\/(estimate|invoice)\/([^/]+)/,
  );
  if (document) {
    try {
      await checkPublicThrottle(
        "read",
        document[2],
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          request.headers.get("x-real-ip"),
      );
    } catch (error) {
      const limited =
        error instanceof AppError && error.code === "RATE_LIMITED";
      return new NextResponse(
        limited
          ? "Too many requests. Try again in 15 minutes."
          : "Customer documents are temporarily unavailable.",
        {
          status: limited ? 429 : 503,
          headers: {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex",
            ...(limited ? { "Retry-After": "900" } : {}),
          },
        },
      );
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isWebhook =
    request.nextUrl.pathname.startsWith("/webhooks/") ||
    request.nextUrl.pathname.startsWith("/api/");
  if (
    url &&
    anon &&
    !isWebhook &&
    !TOKEN_ROUTES.test(request.nextUrl.pathname)
  ) {
    const secure = !["local", "test"].includes(process.env.APP_ENV ?? "local");
    const supabase = createServerClient(url, anon, {
      cookieOptions: { httpOnly: true, secure, sameSite: "lax", path: "/" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const c of list) request.cookies.set(c.name, c.value);
          response = NextResponse.next({ request: { headers } });
          for (const c of list)
            response.cookies.set(c.name, c.value, {
              ...c.options,
              httpOnly: true,
              secure,
              sameSite: "lax",
            });
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
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (request.nextUrl.protocol === "https:")
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  if (
    request.nextUrl.pathname.startsWith("/app") ||
    request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    ["/sign-in", "/forgot-password", "/reset-password", "/verify"].includes(
      request.nextUrl.pathname,
    )
  ) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (
    TOKEN_ROUTES.test(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/auth/")
  ) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  }
  if (request.nextUrl.pathname === "/app/settings/payments") {
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.stripe.com; frame-src https://*.stripe.com https://*.link.com; connect-src 'self' https://*.stripe.com https://*.link.com; img-src 'self' data: https://*.stripe.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    response.headers.set("Cache-Control", "no-store");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
