import { readFile } from "node:fs/promises";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { PublicEstimate } from "./estimates";
import type { RequestMeta } from "./records";
import type { LineDecision, SignatureStrokes } from "@/lib/estimate-decisions";
import { estimateTotals } from "@/lib/estimate-tax";

// Archive the evidence at signing time. This is never regenerated from mutable records.
export async function authorizationPdf(input: {
  estimate: PublicEstimate;
  name: string;
  decisions: LineDecision[];
  signature: SignatureStrokes;
  meta: RequestMeta;
  signedAt: string;
}) {
  const { estimate: e, name, decisions, signature, meta, signedAt } = input;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(`${process.cwd()}/src/assets/authorization-font.ttf`),
    { subset: true },
  );
  let page = doc.addPage([612, 792]);
  let y = 744;
  const text = (value: string) => {
    // Wrap measured words, including arbitrarily long URLs/hashes; keep all evidence text.
    for (const paragraph of value.split("\n")) {
      let line = "";
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(line + char, 10) > 516) {
          if (y < 48) {
            page = doc.addPage([612, 792]);
            y = 744;
          }
          page.drawText(line, { x: 48, y, size: 10, font });
          y -= 16;
          line = "";
        }
        line += char;
      }
      if (y < 48) {
        page = doc.addPage([612, 792]);
        y = 744;
      }
      page.drawText(line, { x: 48, y, size: 10, font });
      y -= 16;
    }
  };
  const money = (n: number) => `$${(n / 100).toFixed(2)}`;
  const policy = e.snapshot.authorizationPolicy!;
  text(`Customer authorization — ${e.snapshot.shopName}`);
  text(`Estimate ${e.id} · Version ${e.version}`);
  text(`${e.snapshot.title} · ${e.snapshot.customerName}`);
  text(e.snapshot.serviceLabel || e.snapshot.vehicleLabel);
  for (const l of e.snapshot.lines) {
    text(
      `${decisions.find((d) => d.id === l.id)!.decision.toUpperCase()}: ${l.description}`,
    );
    text(
      `${l.quantity} × ${money(l.unitPriceCents)} = ${money(l.totalCents)}; ${l.taxable === false ? "not taxable" : "taxable"}`,
    );
  }
  const totals = estimateTotals(
    e.snapshot.lines.filter(
      (l) => decisions.find((d) => d.id === l.id)?.decision === "approve",
    ),
    e.snapshot.taxBps,
  );
  text(
    `Authorized subtotal ${money(totals.subtotalCents)}; tax ${money(totals.taxCents)} at ${e.snapshot.taxBps / 100}%; total ${money(totals.totalCents)}`,
  );
  text(`Estimate terms: ${e.snapshot.terms}`);
  text(
    `Policy ${policy.id} · ${policy.jurisdictionCode} · version ${policy.version}`,
  );
  text(policy.body);
  text(`Policy SHA-256: ${policy.bodySha256}`);
  text(`Signed by ${name.trim()} at ${signedAt}`);
  text(`IP: ${meta.ip ?? "unavailable"}`);
  text(`Browser/device: ${meta.userAgent ?? "unavailable"}`);
  text(`Request: ${meta.requestId}`);
  text(`Estimate SHA-256: ${e.estimateSha256}`);
  if (y < 160) {
    page = doc.addPage([612, 792]);
    y = 744;
  }
  text("Drawn signature:");
  for (const stroke of signature)
    for (let i = 1; i < stroke.length; i++)
      page.drawLine({
        start: { x: 48 + stroke[i - 1].x * 480, y: y - stroke[i - 1].y * 120 },
        end: { x: 48 + stroke[i].x * 480, y: y - stroke[i].y * 120 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
  // Machine-readable UTF-8 evidence preserves exact strings and coordinates too.
  await doc.attach(
    Buffer.from(JSON.stringify(input)),
    "authorization-evidence.json",
    {
      mimeType: "application/json",
      description:
        "Frozen estimate, explicit decisions, signature and request evidence",
    },
  );
  return Buffer.from(await doc.save());
}
