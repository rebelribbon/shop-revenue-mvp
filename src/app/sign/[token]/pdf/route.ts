import { readPublicDocumentPdf } from "@/domain/documents";
export const dynamic = "force-dynamic";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const pdf = await readPublicDocumentPdf((await params).token);
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="signed-document.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}
