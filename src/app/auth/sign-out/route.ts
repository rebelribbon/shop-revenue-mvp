import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACTIVE_BUSINESS_COOKIE,
  VIEW_AS_COOKIE,
  PASSWORD_RESET_COOKIE,
} from "@/server/auth/session";
import { supabaseServer } from "@/server/auth/supabase";
import { clearSecondStep } from "@/server/auth/email-security";

// Older workspace pages used a normal link. Keep GET safe for link previews
// and browser prefetches, but send people to HTML instead of a method-error file.
export function GET(req: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/sign-out", req.nextUrl.origin),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin)
    return new Response("Forbidden", { status: 403 });
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  await clearSecondStep();
  const jar = await cookies();
  jar.delete(PASSWORD_RESET_COOKIE);
  jar.delete(VIEW_AS_COOKIE);
  jar.delete(ACTIVE_BUSINESS_COOKIE);
  const response = NextResponse.redirect(
    new URL("/sign-in", req.nextUrl.origin),
    {
      status: 303,
    },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
