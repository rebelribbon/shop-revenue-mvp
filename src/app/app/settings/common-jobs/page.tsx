import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { requireOwnerView } from "@/server/views/shop";
import { withTenant } from "@/db/tenant";
import { eq } from "drizzle-orm";
import { business } from "@/db/schema";
import { isAutomotive } from "@/lib/business-types";
import { listCommonJobs } from "@/domain/common-jobs";
import { ActionForm } from "@/components/action-form";
import { archiveCommonJobAction } from "@/server/actions/owner-tools";
export default async function CommonJobsPage() {
  const s = await requireOwnerView("/app/settings/common-jobs");
  const { jobs, auto } = await withTenant(s.businessId, s.actor, async (tx) => {
    const [b] = await tx
      .select({ type: business.businessType })
      .from(business)
      .where(eq(business.id, s.businessId));
    return {
      jobs: await listCommonJobs(tx),
      auto: isAutomotive(b?.type ?? "automotive"),
    };
  });
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Common jobs</h1>
      <p>
        Save common work from the job editor, then use it on your next job.{" "}
        {jobs.length} of 25 saved.
      </p>
      <Link href="/app/jobs?new=1" className="btn primary" data-page-primary>
        New job
      </Link>
      {jobs.map((job) => (
        <section className="card" key={job.id}>
          <h2>{job.name}</h2>
          <p>
            {job.parts.length} {auto ? "parts" : "materials"} ·{" "}
            {job.labor.length} labor items
          </p>
          {s.actor.type !== "support" && (
            <ActionForm
              action={archiveCommonJobAction}
              hidden={{ id: job.id }}
              submitLabel="Remove common job"
              variant="danger"
              confirm="Remove this saved job? Existing customer jobs will be kept."
            />
          )}
        </section>
      ))}
    </HydratedMain>
  );
}
