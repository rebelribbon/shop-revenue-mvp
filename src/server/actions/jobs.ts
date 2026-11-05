"use server";
import { createJob, jobInput } from "@/domain/jobs";
import { requireAssignedJob } from "@/domain/job-access";
import { defineShopAction } from "./define";
export const createJobAction = defineShopAction({
  name: "createJob",
  technicianAccess: requireAssignedJob,
  input: jobInput,
  run: ({ tx }, input) => createJob(tx, input),
});
