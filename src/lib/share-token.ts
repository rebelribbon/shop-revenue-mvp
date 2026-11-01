import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
function key() {
  const secret = process.env.SESSION_SIGNING_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Sharing encryption is not configured");
  return createHash("sha256")
    .update("shop-revenue:share-token:v1:" + secret)
    .digest();
}
export function sealShareToken(token: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const bytes = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    bytes.toString("base64url"),
  ].join(".");
}
export function openShareToken(value: string) {
  const [version, iv, tag, bytes] = value.split(".");
  if (version !== "v1" || !iv || !tag || !bytes)
    throw new Error("Sharing link unavailable");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(bytes, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}
