import { readPublicAuthorizationPdf } from "@/domain/estimates";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const pdf = await readPublicAuthorizationPdf(token);
  if (!pdf)
    return new Response("Authorization PDF unavailable.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  return new Response(new Uint8Array(Buffer.from(pdf, "base64")), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=authorization.pdf",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
