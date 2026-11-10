"use server";
import { createJob, jobInput } from "@/domain/jobs";
import { defineShopAction } from "./define";
export const createJobAction = defineShopAction({
  name: "createJob",
  input: jobInput,
  run: ({ tx }, input) => createJob(tx, input),
});
