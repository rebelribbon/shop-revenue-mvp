import { HydratedMain } from "@/components/hydrated-main";
import { requireInternal } from "@/server/views/admin";
import { releaseConfiguration } from "@/lib/release-readiness";
import { maintenanceStatus } from "@/domain/maintenance";
export default async function ReleaseReadinessPage() {
  await requireInternal("admin");
  const checks = releaseConfiguration(process.env),
    maintenance = await maintenanceStatus().catch(() => ({
      healthy: false,
      lastSuccessAt: null,
    }));
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Release readiness</h1>
      <p>
        Runtime configuration checks do not replace delivery tests, restore
        evidence, alert drills, independent security review, or founder
        approval.
      </p>
      <p>
        Environment: {process.env.APP_ENV ?? "unknown"} · Build:{" "}
        {process.env.VERCEL_GIT_COMMIT_SHA ?? "local"}
      </p>
      <section className="card">
        <h2>Scheduled maintenance</h2>
        <p>
          {maintenance.healthy
            ? "Recent successful run verified"
            : "No recent successful run verified"}
        </p>
        <p>
          Last success:{" "}
          {maintenance.lastSuccessAt
            ? new Date(maintenance.lastSuccessAt).toLocaleString("en-US", {
                timeZone: "America/Chicago",
              })
            : "None"}
        </p>
      </section>
      {checks.map((c) => (
        <article className="card" key={c.key}>
          <strong>
            {c.ready ? "Configured" : "Missing / unverified"} · {c.key}
          </strong>
          <p>{c.message}</p>
        </article>
      ))}
      <p>
        Do not enable the first real shop until the external evidence checklist
        and release gate pass.
      </p>
    </HydratedMain>
  );
}
