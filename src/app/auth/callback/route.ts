import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { grantPasswordReset } from "@/server/auth/session";
import { supabaseServer } from "@/server/auth/supabase";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  if (code) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      if (next.startsWith("/reset-password")) await grantPasswordReset(data.user.id);
      return NextResponse.redirect(new URL(next, req.nextUrl.origin));
    }
  }
  return NextResponse.redirect(new URL("/sign-in?error=recovery", req.nextUrl.origin));
}
