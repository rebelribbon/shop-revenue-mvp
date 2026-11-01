import type { NextConfig } from "next";

// cacheComponents stays off: every shop page is rendered per request under the
// signed-in tenant, and nothing tenant-scoped is cached across requests (F19:
// "cached per request, no stale snapshots").
const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/*": ["./src/assets/authorization-font.ttf"] },
  serverExternalPackages: ["pg", "graphile-worker", "pino"],
};

export default nextConfig;
