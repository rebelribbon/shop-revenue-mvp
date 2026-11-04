// "My day": what one person is on today — their jobs in the bay, approved
// or waiting on a quote, their visits today, and their running clock.
import type { TenantTx } from "@/db/tenant";
import { listTodayTomorrow } from "./appointments";
import { jobAssignees } from "./assignments";
import { myClock } from "./job-profit";
import { getJob } from "./jobs";
import { loadPipeline, type BoardCard } from "./pipeline";

export async function myDay(tx: TenantTx, userId: string, now = new Date()) {
  const [pipeline, visits, clock, assigned] = await Promise.all([
    loadPipeline(tx, now),
    listTodayTomorrow(tx, now),
    myClock(tx),
    jobAssignees(tx),
  ]);
  const mine = (c: BoardCard) => c.techId === userId;
  // In the bay first, then approved and waiting, then ones to look over
  // and quote (an estimate already sent is waiting on the customer).
  const jobs = [
    ...pipeline.columns.working.filter(mine),
    ...pipeline.columns.approved.filter(mine),
    ...pipeline.columns.estimate.filter((c) => mine(c) && c.status === "draft"),
  ];
  const myVisits = visits.today.filter(
    (v) =>
      v.status === "scheduled" &&
      (v.assignedUserId === userId ||
        (!v.assignedUserId &&
          !!v.planJobId &&
          assigned.get(v.planJobId) === userId)),
  );
  // Today's visits nobody is on yet, so a tech can pick one up.
  const openVisits = visits.today.filter(
    (v) =>
      v.status === "scheduled" &&
      !v.assignedUserId &&
      !(v.planJobId && assigned.get(v.planJobId)),
  );
  return {
    timezone: visits.timezone,
    jobs,
    visits: myVisits,
    openVisits,
    unassignedVisits: openVisits.length,
    clock: clock
      ? {
          ...clock,
          jobTitle:
            jobs.find((j) => j.id === clock.jobId)?.title ??
            (await getJob(tx, clock.jobId))?.title ??
            "a job",
        }
      : null,
  };
}
