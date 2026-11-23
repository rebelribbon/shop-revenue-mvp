import type { NextConfig } from "next";

// cacheComponents stays off: every shop page is rendered per request under the
// signed-in tenant, and nothing tenant-scoped is cached across requests (F19:
// "cached per request, no stale snapshots").
const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/*": [
      "./src/assets/authorization-font.ttf",
      "./docs/approved-designs/automotive-unified.html",
      "./src/app/automotive/live-bridge.js",
      "./src/app/automotive/billing.css",
    ],
  },
  serverExternalPackages: ["pg", "graphile-worker", "pino"],
};

export default nextConfig;
