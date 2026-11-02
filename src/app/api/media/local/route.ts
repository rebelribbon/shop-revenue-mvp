// Development/test stand-in for the storage provider's signed URLs.
import {
  mediaDriver,
  readLocal,
  verifyLocal,
  writeLocal,
} from "@/lib/media-storage";
import { MEDIA_TYPES } from "@/domain/job-media";

export const dynamic = "force-dynamic";
const parse = (req: Request) => {
  const u = new URL(req.url).searchParams;
  return {
    key: u.get("key") ?? "",
    exp: Number(u.get("exp")),
    sig: u.get("sig") ?? "",
  };
};
const deny = () => new Response("Forbidden", { status: 403 });

export async function PUT(req: Request) {
  if (mediaDriver() !== "local") return deny();
  const { key, exp, sig } = parse(req);
  if (!verifyLocal(key, "PUT", exp, sig)) return deny();
  const body = Buffer.from(await req.arrayBuffer());
  if (!body.length || body.length > 150 * 1024 * 1024) return deny();
  await writeLocal(key, body);
  return new Response(null, { status: 200 });
}

export async function GET(req: Request) {
  if (mediaDriver() !== "local") return deny();
  const { key, exp, sig } = parse(req);
  if (!verifyLocal(key, "GET", exp, sig)) return deny();
  try {
    const body = await readLocal(key);
    const ext = key.split(".").pop();
    const type =
      Object.entries(MEDIA_TYPES).find(([, v]) => v.ext === ext)?.[0] ??
      "application/octet-stream";
    return new Response(new Uint8Array(body), {
      headers: { "Content-Type": type, "Cache-Control": "private, no-store" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
