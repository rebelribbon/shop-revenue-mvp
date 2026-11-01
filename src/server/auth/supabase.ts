// Supabase Auth on the server only. The session cookie is httpOnly, Secure (outside
// local), SameSite=Lax (Section 9); the browser never talks to Supabase or the DB.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";

const env = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon)
    throw new AppError("PROVIDER_UNAVAILABLE", "Sign-in is not configured.");
  return { url, anon };
};

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: !["local", "test"].includes(process.env.APP_ENV ?? "local"),
  sameSite: "lax" as const,
  path: "/",
};

export async function supabaseServer() {
  const { url, anon } = env();
  const store = await cookies();
  return createServerClient(url, anon, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const c of list)
            store.set(c.name, c.value, {
              ...c.options,
              ...AUTH_COOKIE_OPTIONS,
            });
        } catch {
          // Called from a Server Component render: proxy.ts refreshes cookies instead.
        }
      },
    },
  });
}

// Service-role client for user administration (invite acceptance creates the auth
// user). BLOCKED on hosted environments until SUPABASE_SERVICE_ROLE_KEY is set.
export function supabaseAdmin() {
  const { url } = env();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Account administration is not configured.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
