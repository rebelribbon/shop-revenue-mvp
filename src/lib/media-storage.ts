// Private storage for job photos and videos. Supabase Storage on hosted
// environments; a local folder for development and tests. Browsers upload
// straight to storage with a short-lived signed URL and read through our own
// /media route, which checks access and then redirects to a signed URL.
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "./errors";

type Driver = "supabase" | "local";
export function mediaDriver(env = process.env): Driver | null {
  if (env.MEDIA_STORAGE === "local") return "local";
  if (
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.MEDIA_BUCKET
  )
    return "supabase";
  return env.APP_ENV === "production" || env.APP_ENV === "staging"
    ? null
    : "local";
}
export const mediaConfigured = () => mediaDriver() !== null;

function requireDriver() {
  const d = mediaDriver();
  if (!d)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Photo storage isn’t set up yet.",
    );
  return d;
}
const bucket = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ).storage.from(process.env.MEDIA_BUCKET!);

const localRoot = () =>
  resolve(process.env.MEDIA_LOCAL_DIR || join(process.cwd(), ".local-media"));
const localPath = (key: string) => {
  const p = resolve(localRoot(), key);
  if (!p.startsWith(localRoot() + "/"))
    throw new AppError("VALIDATION", "Bad media path.");
  return p;
};
const secret = () =>
  process.env.SESSION_SIGNING_SECRET || "local-media-development-only-secret";
export function signLocal(key: string, method: "PUT" | "GET", exp: number) {
  return createHmac("sha256", secret())
    .update(`${method}\n${key}\n${exp}`)
    .digest("hex");
}
export function verifyLocal(
  key: string,
  method: "PUT" | "GET",
  exp: number,
  sig: string,
) {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = Buffer.from(signLocal(key, method, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
const localUrl = (key: string, method: "PUT" | "GET", ttlMs: number) => {
  const exp = Date.now() + ttlMs;
  return `/api/media/local?${new URLSearchParams({ key, exp: String(exp), sig: signLocal(key, method, exp) })}`;
};

export async function createUploadUrl(key: string) {
  if (requireDriver() === "local") return localUrl(key, "PUT", 15 * 60000);
  const { data, error } = await bucket().createSignedUploadUrl(key);
  if (error || !data)
    throw new AppError("PROVIDER_UNAVAILABLE", "Couldn’t start the upload.");
  return data.signedUrl;
}

export async function createReadUrl(key: string, ttlSeconds = 300) {
  if (requireDriver() === "local")
    return localUrl(key, "GET", ttlSeconds * 1000);
  const { data, error } = await bucket().createSignedUrl(key, ttlSeconds);
  if (error || !data)
    throw new AppError("PROVIDER_UNAVAILABLE", "Couldn’t open that file.");
  return data.signedUrl;
}

// Size and type of an uploaded object, or null if it isn't there.
export async function statObject(
  key: string,
): Promise<{ size: number; contentType: string | null } | null> {
  if (requireDriver() === "local") {
    try {
      const s = await stat(localPath(key));
      return { size: s.size, contentType: null };
    } catch {
      return null;
    }
  }
  const { data, error } = await bucket().info(key);
  if (error || !data) return null;
  return {
    size: Number(data.size ?? 0),
    contentType: (data.contentType as string | undefined) ?? null,
  };
}

export async function writeLocal(key: string, body: Buffer) {
  const p = localPath(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body);
}
export const readLocal = (key: string) => readFile(localPath(key));
