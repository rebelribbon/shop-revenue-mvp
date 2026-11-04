import { describe, expect, it } from "vitest";
import { listInvoices } from "@/domain/invoices";
import { loadFollowUpRules } from "@/domain/money-finder";
import { listTasks, saveFollowUpRules } from "@/domain/tasks";
import { unpaidInvoice } from "../helpers/invoices";
import { meta } from "../helpers/fixtures";

describe("Warranty reminders", () => {
  it("prints the warranty and puts a task on the list before it ends", async () => {
    const f = await unpaidInvoice(null, null, { warrantyMonths: 1 });
    const [inv] = await f.run((tx) => listInvoices(tx, f.invoiceId));
    expect(inv?.snapshot.warrantyMonths).toBe(1);

    const rules = await f.run((tx) => loadFollowUpRules(tx));
    // Ends in about a month: inside a 45-day warning window.
    await f.run((tx) =>
      saveFollowUpRules(tx, meta(), {
        ...rules,
        unpaid: { ...rules.unpaid, on: false },
        warranty: { on: true, daysBefore: 45 },
      }),
    );
    const due = (await f.run((tx) => listTasks(tx))).due;
    const task = due.find((t) => t.category === "warranty_ending");
    expect(task?.title).toMatch(
      /^Invite Remy TEST in before their warranty ends/,
    );
    expect(task?.detail ?? "").toMatch(/Warranty on Brakes ends/);

    // Rule off: gone.
    await f.run((tx) =>
      saveFollowUpRules(tx, meta(), {
        ...rules,
        unpaid: { ...rules.unpaid, on: false },
        warranty: { on: false, daysBefore: 45 },
      }),
    );
    expect(
      (await f.run((tx) => listTasks(tx))).due.some(
        (t) => t.category === "warranty_ending",
      ),
    ).toBe(false);
  });

  it("doesn't nag about warranties that are far off", async () => {
    const f = await unpaidInvoice(null, null, { warrantyMonths: 12 });
    const due = (await f.run((tx) => listTasks(tx))).due;
    expect(due.some((t) => t.category === "warranty_ending")).toBe(false);
  });
});
