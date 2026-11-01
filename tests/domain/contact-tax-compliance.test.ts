// Customer text/email opt-outs and the owner-confirmed tax rate.
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import { createCustomer, setContactPermission } from "@/domain/customers";
import { inQuietHours, shareRecipient } from "@/domain/document-sharing";
import {
  getBusinessProfile,
  updateBusinessProfile,
} from "@/domain/business-profile";
import { meta, seedTenant } from "../helpers/fixtures";

async function shop(label: string) {
  const s = await seedTenant(label);
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(s.businessId, s.owner.actor, fn);
  return { s, run };
}

describe("text and email opt-outs", () => {
  it("records a STOP, hides the channel, and can be turned back on", async () => {
    const { run } = await shop("OptOut");
    const c = await run((tx) =>
      createCustomer(tx, meta(), {
        firstName: "Stop",
        lastName: "Tester",
        phoneE164: "+12105550188",
        email: "stop@x.test",
      }),
    );
    let r = await run((tx) => shareRecipient(tx, c.id));
    expect(r.textStoppedOn).toBeNull();
    expect(r.emailStoppedOn).toBeNull();

    const first = await run((tx) =>
      setContactPermission(tx, meta(), c.id, "text", false),
    );
    expect(first.changed).toBe(true);
    const again = await run((tx) =>
      setContactPermission(tx, meta(), c.id, "text", false),
    );
    expect(again.changed).toBe(false);
    r = await run((tx) => shareRecipient(tx, c.id));
    expect(r.textStoppedOn).not.toBeNull();
    expect(r.emailStoppedOn).toBeNull();

    await run((tx) => setContactPermission(tx, meta(), c.id, "email", false));
    r = await run((tx) => shareRecipient(tx, c.id));
    expect(r.emailStoppedOn).not.toBeNull();

    await run((tx) => setContactPermission(tx, meta(), c.id, "text", true));
    r = await run((tx) => shareRecipient(tx, c.id));
    expect(r.textStoppedOn).toBeNull();
  });

  it("flags texting hours before 8 AM and from 9 PM in the shop's time zone", () => {
    const at = (iso: string) => inQuietHours("America/Chicago", new Date(iso));
    expect(at("2026-11-02T13:00:00Z")).toBe(true); // 7:00 AM CST
    expect(at("2026-11-02T14:00:00Z")).toBe(false); // 8:00 AM
    expect(at("2026-11-03T02:59:00Z")).toBe(false); // 8:59 PM
    expect(at("2026-11-03T03:00:00Z")).toBe(true); // 9:00 PM
  });
});

describe("owner-confirmed tax rate", () => {
  const base = { legalName: "Tax Shop", timezone: "America/Chicago" };

  it("requires the owner to confirm the rate the first time and after any change", async () => {
    const { run } = await shop("TaxConfirm");
    await expect(
      run((tx) =>
        updateBusinessProfile(tx, meta(), { ...base, taxRateBps: 825 }),
      ),
    ).rejects.toThrow(/confirm you chose this tax rate/i);

    await run((tx) =>
      updateBusinessProfile(tx, meta(), {
        ...base,
        taxRateBps: 825,
        taxConfirmed: true,
      }),
    );
    const p = await run((tx) => getBusinessProfile(tx));
    expect(p.taxRateBps).toBe(825);
    expect(p.taxRateConfirmedAt).toBeInstanceOf(Date);
    expect(p.taxRateConfirmedBy).not.toBeNull();

    // Same tax settings, other edits: no new confirmation needed.
    await run((tx) =>
      updateBusinessProfile(tx, meta(), {
        ...base,
        city: "Austin",
        taxRateBps: 825,
      }),
    );

    // A new rate or default must be confirmed again.
    await expect(
      run((tx) =>
        updateBusinessProfile(tx, meta(), { ...base, taxRateBps: 900 }),
      ),
    ).rejects.toThrow(/confirm/i);
    await expect(
      run((tx) =>
        updateBusinessProfile(tx, meta(), {
          ...base,
          taxRateBps: 825,
          laborTaxableDefault: true,
        }),
      ),
    ).rejects.toThrow(/confirm/i);
  });
});
