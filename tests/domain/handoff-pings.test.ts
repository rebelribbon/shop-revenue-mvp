import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { assignAdvisor, assignJob } from "@/domain/assignments";
import { createCustomer, createVehicle } from "@/domain/customers";
import {
  handoffPingsOn,
  prepareHandoffPing,
  sendHandoffPing,
  setHandoffPings,
} from "@/domain/handoff-pings";
import { getInspection, saveInspection } from "@/domain/inspections";
import { createJob } from "@/domain/jobs";
import { acceptInvite, inviteStaff } from "@/domain/membership";
import {
  MemoryEmailProvider,
  setEmailProviderForTests,
} from "@/providers/email";
import { meta, seedTenant } from "../helpers/fixtures";

const mail = new MemoryEmailProvider();
beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.EMAIL_FROM_ADDRESS = "test@example.test";
  setEmailProviderForTests(mail);
});
afterAll(() => setEmailProviderForTests(null));

// A shop with an owner, a staff advisor, a technician and one RO.
async function shop() {
  const t = await seedTenant("Ping", { withStaff: true });
  const as =
    (actor: Parameters<typeof withTenant>[1]) =>
    <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(t.businessId, actor, fn);
  const owner = as(t.owner.actor);
  const advisor = as(t.staff!.actor);
  const techEmail = `tech-${randomUUID()}@shop.example.test`;
  const inv = await owner((tx) =>
    inviteStaff(tx, meta(), {
      name:¶»§q«^