import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("a text follow-up opens the customer's number directly and keeps Done separate", async ({
  page,
}, info) => {
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers/new");
  const name = `Follow-up ${info.project.name} ${Date.now()}`;
  const phone = info.project.name === "phone" ? "2105550194" : "2105550195";
  await page.getByLabel("First name", { exact: true }).fill(name);
  await page.getByLabel("Mobile number", { exact: true }).fill(phone);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  const customerPath = new URL(page.url()).pathname;

  await page.goto("/app/tasks");
  await page.getByRole("link", { name: "+ Add task", exact: true }).click();
  const title = `Text about the estimate for ${name}`;
  await page.getByLabel("What do you need to do?").fill(title);
  await page
    .getByLabel("When", { exact: true })
    .fill(new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
  await page.getByLabel("Customer (optional)").selectOption({ label: name });
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByText("Task added.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Close", exact: true }).click();

  const task = page.getByRole("listitem").filter({ hasText: title });
  // Inspect the native link instead of launching a messaging app during a test.
  for (const label of [title, "Text"]) {
    await expect(
      task.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("href", `sms:+1${phone}`);
  }
  await expect(
    task.getByRole("link", { name: "Call", exact: true }),
  ).toHaveCount(0);
  const record = task.getByRole("link", { name: "View customer", exact: true });
  await expect(record).toHaveAttribute("href", customerPath);
  await auditUX(page);
  await record.click();
  await expect(page).toHaveURL(new RegExp(`${customerPath}$`));

  await page.goto("/app/tasks");
  await task.getByRole("link", { name: "Text", exact: true }).click();
  const contact = page.getByRole("dialog", { name: "Log customer contact" });
  await expect(contact.getByLabel("Contact method")).toHaveValue("text");
  await contact
    .getByLabel("Short summary")
    .fill("Sent an update about the estimate.");
  await contact.getByRole("button", { name: "Save to history" }).click();
  await expect(contact).not.toBeVisible();
  await task.getByRole("button", { name: "Done", exact: true }).click();
  await expect(task).toHaveCount(0);

  await page.goto(`${customerPath}?view=history`);
  const history = page.getByRole("region", { name: "Customer history" });
  await expect(history).toContainText("Text shortcut opened");
  await expect(history).toContainText(
    "Text · Sent — Sent an update about the estimate.",
  );
  await expect(history).toContainText(`Task completed · ${title}`);
  await history.getByRole("button", { name: "Log contact" }).click();
  await contact.getByLabel("What happened?").selectOption("received");
  await contact
    .getByLabel("Short summary")
    .fill("Customer replied with a question about parts.");
  await contact.getByRole("button", { name: "Save to history" }).click();
  await expect(history).toContainText(
    "Text · Received — Customer replied with a question about parts.",
  );
});
