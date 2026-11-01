import { z } from "zod";
export const lineDecisionSchema = z.object({
  id: z.string().min(1).max(40),
  decision: z.enum(["approve", "decline"]),
});
export type LineDecision = z.infer<typeof lineDecisionSchema>;
export const signatureSchema = z
  .array(
    z
      .array(
        z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
      )
      .min(2)
      .max(500),
  )
  .min(1)
  .max(20)
  .refine(
    (strokes) => strokes.reduce((n, s) => n + s.length, 0) <= 5000,
    "Signature is too large.",
  );
export type SignatureStrokes = z.infer<typeof signatureSchema>;
export function completeDecisions(
  lineIds: string[],
  decisions: LineDecision[],
) {
  return (
    decisions.length === lineIds.length &&
    new Set(decisions.map((d) => d.id)).size === lineIds.length &&
    decisions.every((d) => lineIds.includes(d.id))
  );
}
