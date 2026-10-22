// Only same-origin relative paths are allowed as post-sign-in destinations.
export const safeNext = (next: string | null | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/app";
