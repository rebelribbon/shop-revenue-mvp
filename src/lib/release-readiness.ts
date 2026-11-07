export type ReleaseCheck = { key: string; ready: boolean; message: string };
export function releaseProfileChecks(
  env: Record<string, string | undefined>,
): ReleaseCheck[] {
  const profile = env.RELEASE_PROFILE ?? "commercial";
  return [
    {
      key: "release-profile",
      ready: profile === "commercial" || profile === "pilot",
      message: "Release profile must be commercial or pilot",
    },
    ...(profile === "pilot"
      ? [
          {
            key: "pilot-signup-closed",
            ready: env.PUBLIC_SIGNUP_ENABLED === "false",
            message:
              "Pilot release requires public signup closed; provider database backups only",
          },
        ]
      : []),
  ];
}

export function requiredReleaseEvidence(profile = "commercial") {
  const keys = [
    "independentSecurityReview",
    "productionAuthAndMfa",
    "smtpDelivery",
    "offsiteBackupRestore",
    "productionRecovery",
    "alertsAndOnCall",
    "designPartnerApproval",
  ];
  // The owner-authorized closed pilot deploys for real production verification.
  // Reviews stay visible as pending and remain mandatory for commercial release.
  // An unknown profile retains every commercial requirement and fails above.
  return profile === "pilot" ? [] : keys;
}

export function releaseDecision(profile: string, checks: ReleaseCheck[]) {
  const evidence = new Set(requiredReleaseEvidence());
  const required = new Set(requiredReleaseEvidence(profile));
  const blocking = checks.filter(
    (check) => !evidence.has(check.key) || required.has(check.key),
  );
  const expected = [
    ...releaseConfiguration({}).map((check) => check.key),
    "stripe-account-activation",
    "subscription-catalog",
    "release-commit",
    "release-profile",
    ...evidence,
    ...(profile === "pilot" ? ["pilot-signup-closed"] : []),
  ];
  const complete = expected.every((key) =>
    checks.some((check) => check.key === key),
  );
  return {
    deploymentReady:
      (profile === "commercial" || profile === "pilot") &&
      complete &&
      blocking.every((check) => check.ready),
    launchReady:
      profile === "commercial" &&
      complete &&
      checks.every((check) => check.ready),
    pendingEvidence: [...evidence].filter(
      (key) => !checks.some((check) => check.key === key && check.ready),
    ),
  };
}

export function productionRecoveryReady(
  evidence: Record<string, unknown> | undefined,
  now = Date.now(),
) {
  const recent = (value: unknown) => {
    if (typeof value !== "string") return false;
    const time = Date.parse(value);
    return Number.isFinite(time) && time <= now && now - time <= 86400000;
  };
  if (evidence?.mode === "daily-offsite")
    return (
      recent(evidence.providerBackupAt) && recent(evidence.offsiteBackupAt)
    );
  if (evidence?.mode === "pitr")
    return (
      typeof evidence.retentionDays === "number" &&
      Number.isInteger(evidence.retentionDays) &&
      evidence.retentionDays >= 7 &&
      recent(evidence.latestRestorePointAt)
    );
  return false;
}
export function stripeAccountReady(account: {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[] | null;
    past_due?: string[] | null;
  } | null;
}) {
  return (
    account.charges_enabled === true &&
    account.payouts_enabled === true &&
    account.details_submitted === true &&
    !account.requirements?.disabled_reason &&
    !account.requirements?.currently_due?.length &&
    !account.requirements?.past_due?.length
  );
}
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
      key: "shop-billing",
      ready:
        (present("STRIPE_SUBSCRIPTION_PRICE_ID") ||
          env.STRIPE_SUBSCRIPTION_LOOKUP_KEY === "shop_revenue_monthly") &&
        present("STRIPE_BILLING_WEBHOOK_SECRET"),
      message:
        "Shop subscription price configured; shops must start a trial to make changes",
    },
    {
      key: "no-setup-credentials",
      ready: !present("DEV_OWNER_TEMP_PASSWORD") && !present("DEV_OWNER_EMAIL"),
      message: "Temporary owner bootstrap credentials removed",
    },
  ];
}
