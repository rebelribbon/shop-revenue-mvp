import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { endSupportSession } from "@/domain/support";
import {
  getInternalUser,
  VIEW_AS_COOKIE,
  verifySigned,
} from "@/server/auth/session";
import { getRequestMeta } from "@/server/request";

export async function POST(req: NextRequest) {
  const me = await getInternalUser();
  const jar = await cookies();
  const sessionId = verifySigned(jar.get(VIEW_AS_COOKIE)?.value);
  if (me && sessionId)
    await endSupportSession(
      { internalUserId: me.id },
      await getRequestMeta(),
      sessionId,
    );
  jar.delete(VIEW_AS_COOKIE);
  return NextResponse.redirect(new URL("/admin", req.nextUrl.origin), {
    status: 303,
  });
}
