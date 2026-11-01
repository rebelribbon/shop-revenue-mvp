import { readPublicEstimate, signEstimate } from "@/domain/estimates";
import type { RequestMeta } from "@/domain/records";
export async function signTestEstimate(
  token: string,
  name: string,
  approved: string[],
  meta: RequestMeta,
) {
  const e = await readPublicEstimate(token);
  const decisions = (e?.snapshot.lines ?? []).map((l) => ({
    id: l.id,
    decision: approved.includes(l.id)
      ? ("approve" as const)
      : ("decline" as const),
  }));
  for (const id of approved)
    if (!decisions.some((d) => d.id === id))
      decisions.push({ id, decision: "approve" });
  return signEstimate(
    token,
    name,
    decisions,
    { ...meta, userAgent: "Integration test browser" },
    [
      [
        { x: 0.1, y: 0.2 },
        { x: 0.4, y: 0.6 },
      ],
    ],
  );
}
