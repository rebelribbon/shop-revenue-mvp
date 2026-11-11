import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/server/auth/supabase";
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token_hash");
  const type = req.nextUrl.searchParams.get("type");
  if (token && type === "email") {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({
      type: "email",
      token_hash: token,
    });
    if (!error)
      return NextResponse.redirect(new URL("/start", req.nextUrl.origin));
  }
  return NextResponse.redirect(
    new URL("/sign-in?error=confirmation", req.nextUrl.origin),
  );
}
