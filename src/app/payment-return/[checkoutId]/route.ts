import { cookies } from "next/headers";
import { isWellFormedToken } from "@/lib/tokens";
import { paymentBaseUrl } from "@/lib/stripe";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ checkoutId: string }> },
) {
  const { checkoutId } = await params;
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex",
  };
  if (/^[0-9a-f-]{36}$/i.test(checkoutId)) {
    const jar = await cookies();
    const name = `invoice_return_${checkoutId}`;
    const token = jar.get(name)?.value;
    if (token && isWellFormedToken(token)) {
      jar.set(name, "", {
        maxAge: 0,
        path: "/payment-return",
        httpOnly: true,
        sameSite: "lax",
        secure: !["local", "test"].includes(process.env.APP_ENV ?? "local"),
      });
      const outcome =
        new URL(req.url).searchParams.get("outcome") === "canceled"
          ? "canceled"
          : "processing";
      return new Response(null, {
        status: 303,
        headers: {
          ...headers,
          Location: `${paymentBaseUrl()}/invoice/${token}?payment=${outcome}`,
        },
      });
    }
  }
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment status | Shop Revenue</title><main><h1>Return to your invoice</h1><p>Open the invoice link your shop sent you to see the latest balance. If you just paid, confirmation may take a moment.</p></main></html>',
    {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      },
    },
  );
}
