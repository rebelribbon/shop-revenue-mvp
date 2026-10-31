import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Public and invite tokens: 32 random bytes, base64url (43 chars); only the
// SHA-256 hash is ever stored (Section 8).
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const isWellFormedToken = (token: string) =>
  /^[A-Za-z0-9_-]{43}$/.test(token);

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
