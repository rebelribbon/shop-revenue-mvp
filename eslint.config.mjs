import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Section 9: the raw database client may only be imported by db/tenant.ts and
// db/admin.ts. Everything else receives a tenant-scoped transaction.
const RAW_DB_IMPORTS = {
  paths: [
    { name: "pg", message: "Use withTenant() from @/db/tenant (Section 9). Raw clients live only in src/db/tenant.ts and src/db/admin.ts." },
    { name: "pg-pool", message: "Use withTenant() from @/db/tenant (Section 9)." },
  ],
  patterns: [
    { group: ["drizzle-orm/node-postgres", "drizzle-orm/node-postgres/*"], message: "Use withTenant() from @/db/tenant (Section 9)." },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/db/tenant.ts", "src/db/admin.ts"],
    rules: { "no-restricted-imports": ["error", RAW_DB_IMPORTS] },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
