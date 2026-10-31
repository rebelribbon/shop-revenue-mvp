import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import type { RequestMeta } from "@/domain/records";

// Request ID generated at the edge (proxy.ts) and passed into actions (Section 20).
// Client IP: first hop of the hosting platform's trusted forwarded header (Section 16).
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const requestId = h.get("x-request-id") ?? randomUUID();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;
  return {
    requestId,
    ip,
    userAgent: h.get("user-agent")?.slice(0, 2000) ?? null,
  };
}
