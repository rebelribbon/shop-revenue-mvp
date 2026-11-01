import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACTIVE_BUSINESS_COOKIE,
  VIEW_AS_COOKIE,
  PASSWORD_RESET_COOKIE,
} from "@/server/auth/session";
import { supabaseServer } from "@/server/auth/supabase";

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin)
    return new Response("Forbidden", { status: 403 });
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  const jar = await cookies();
  jar.delete(PASSWORD_RESET_COOKIE);
  jar.delete(VIEW_AS_COOKIE);
  jar.delete(ACTIVE_BUSINESS_COOKIE);
  return NextResponse.redirect(new URL("/sign-in", req.nextUrl.origin), {
    status: 303,
  });
}
