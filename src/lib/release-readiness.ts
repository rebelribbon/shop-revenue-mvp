export type ReleaseCheck = { key: string; ready: boolean; message: string };
export function releaseConfiguration(
  env: Record<string, string | undefined>,
  allowRuntimePlaceholders = false,
): ReleaseCheck[] {
  const present = (key: string) =>
    !!env[key] &&
    env[key] !== "disabled-bootstrap-removed" &&
    (allowRuntimePlaceholders || !/^\[SENSITIVE\]$/i.test(env[key]!));
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return [
    {
      key: "database",
      ready:
        present("DATABASE_URL_APP") &&
        present("DATABASE_URL_WORKER") &&
        present("DATABASE_URL_ADMIN"),
      message: "App, worker and admin database roles configured",
    },
    {
      key: "public-auth",
      ready:
        present("NEXT_PUBLIC_SUPABASE_URL") &&
        /^(sb_publishable_|eyJ)/.test(publicKey),
      message: "Usable public Supabase build configuration",
    },
    {
      key: "account-administration",
      ready: present("SUPABASE_SERVICE_ROLE_KEY"),
      message: "Server-side account invitation administration configured",
    },
    {
      key: "email",
      ready:
        (present("EMAIL_FROM_ADDRESS") || present("EMAIL_FROM")) &&
        ((env.EMAIL_PROVIDER === "resend" && present("RESEND_API_KEY")) ||
          (env.EMAIL_PROVIDER === "postmark" &&
            present("POSTMARK_SERVER_TOKEN"))),
      message:
        "Transactional email configured; delivered email still requires verification",
    },
    {
      key: "maintenance",
      ready:
        ((env.CRON_SECRET?.length ?? 0) >= 32 ||
          (allowRuntimePlaceholders && env.CRON_SECRET === "[SENSITIVE]")) &&
        env.MAINTENANCE_SCHEDULE_ENABLED === "true",
      message: "Authenticated maintenance and hosted schedule configured",
    },
    {
      key: "monitoring",
      ready: present("SENTRY_DSN") || present("NEXT_PUBLIC_SENTRY_DSN"),
      message:
        "Error monitoring configured; alert delivery still requires verification",
    },
    {
      key: "admin-sso",
      ready: present("ADMIN_ALLOWED_EMAIL_DOMAIN"),
      message:
        "Admin Google domain configured; provider and allowlist still require verification",
    },
    {
      key: "session-secret",
      ready:
        (env.SESSION_SIGNING_SECRET?.length ?? 0) >= 32 ||
        (allowRuntimePlaceholders &&
          env.SESSION_SIGNING_SECRET === "[SENSITIVE]"),
      message: "Session signing key meets minimum length",
    },
    {
      key: "production-payments",
      ready:
        (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "") ||
          (allowRuntimePlaceholders &&
            env.STRIPE_SECRET_KEY === "[SENSITIVE]")) &&
        present("STRIPE_WEBHOOK_SECRET"),
      message:
        "Production payment configuration present; live verification remains required",
    },
    {
      key: "no-setup-credentials",
      ready: !present("DEV_OWNER_TEMP_PASSWORD") && !present("DEV_OWNER_EMAIL"),
      message: "Temporary owner bootstrap credentials removed",
    },
  ];
}
