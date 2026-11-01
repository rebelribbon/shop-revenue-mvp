// The Team page must not say "Invite sent" when the text or email never went out.
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/tenant";
import {
  INVITE_DELIVERY_ACTION,
  inviteDeliveryStatus,
  inviteStaff,
} from "@/domain/membership";
import { audit } from "@/domain/records";
import { meta, seedTenant } from "../helpers/fixtures";

describe("invite delivery status", () => {
  it("reports the latest attempt per invite and nothing for untried ones", async () => {
    const s = await seedTenant("InviteStatus");
    const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(s.businessId, s.owner.actor, fn);
    const a = await run((tx) =>
      inviteStaff(tx, meta(), { name: "Texted", phoneE164: "+12105550101" }),
    );
    const b = await run((tx) =>
      inviteStaff(tx, meta(), { name: "Untried", email: "untried@x.test" }),
    );
    const record = (status: "sent" | "failed") =>
      run((tx) =>
        audit(tx, meta(), {
          action: INVITE_DELIVERY_ACTION,
          targetType: "membership",
          targetId: a.membershipId,
          after: { status, channel: "sms" },
        }),
      );

    await record("failed");
    let st = await run((tx) =>
      inviteDeliveryStatus(tx, [a.membershipId, b.membershipId]),
    );
    expect(st.get(a.membershipId)).toBe("failed");
    expect(st.has(b.membershipId)).toBe(false);

    await new Promise((r) => setTimeout(r, 5));
    await record("sent");
    st = await run((tx) => inviteDeliveryStatus(tx, [a.membershipId]));
    expect(st.get(a.membershipId)).toBe("sent");
  });
});
