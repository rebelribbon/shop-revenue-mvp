import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("contact tasks log the outcome and update the task in one step", async ({
  page,
}, info) => {
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers/new");
  const name = `Follow-up ${info.project.name} ${Date.now()}`;
  const phone = info.project.name === "phone" ? "2105550194" : "2105550195";
  const email = `follow-up-${info.project.name}@example.test`;
  await page.getByLabel("First name", { exact: true }).fill(name);
  await page.getByLabel("Mobile number", { exact: true }).fill(phone);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  const customerPath = new URL(page.url()).pathname;

  const title = `Text about the estimate for ${name}`;
  const emailTitle = `Email the estimate to ${name}`;
  await page.goto("/app/tasks");
  for (const taskTitle of [title, emailTitle]) {
    await page.getByRole("link", { name: "+ Add task", exact: true }).click();
    await page.getByLabel("What do you need to do?").fill(taskTitle);
    await page
      .getByLabel("When", { exact: true })
      .fill(new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
    await page.getByLabel("Customer (optional)").selectOption({ label: name });
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByText("Task added.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Close", exact: true }).click();
  }

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
  await expect(contact.getByLabel("Short summary")).toHaveValue("");
  await expect(
    contact.getByRole("option", { name: "Left message" }),
  ).toHaveCount(0);
  await contact
    .getByLabel("Short summary")
    .fill("Sent an update about the estimate.");
  await contact.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(contact).not.toBeVisible();
  await expect(task).toBeVisible();

  await task.getByRole("link", { name: "Text", exact: true }).click();
  await contact.getByLabel("What happened?").selectOption("received");
  await contact
    .getByLabel("Short summary")
    .fill("Customer asked for a callback next week.");
  await contact
    .getByRole("button", { name: "Save & follow up", exact: true })
    .click();
  const followUp = contact.getByLabel("Follow-up date", { exact: true });
  const followUpOn = new Date(Date.now() + 6 * 86400000)
    .toISOString()
    .slice(0, 10);
  await followUp.fill(followUpOn);
  await auditUX(page);
  await contact
    .getByRole("button", { name: "Save & follow up", exact: true })
    .click();
  await expect(task).toHaveCount(0);

  const emailTask = page.getByRole("listitem").filter({ hasText: emailTitle });
  const emailLink = emailTask.getByRole("link", { name: "Email", exact: true });
  await expect(emailLink).toHaveAttribute("href", `mailto:${email}`);
  await emailLink.click();
  await expect(contact.getByLabel("Contact method")).toHaveValue("email");
  await contact
    .getByLabel("Short summary")
    .fill("Emailed the updated estimate.");
  await contact
    .getByRole("button", { name: "Save & complete task", exact: true })
    .click();
  await expect(emailTask).toHaveCount(0);
  await page.getByRole("link", { name: "Coming up", exact: true }).click();
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(`${followUpOn}T12:00:00Z`));
  await expect(task).toContainText(dateLabel);
  await expect(emailTask).toHaveCount(0);

  await page.goto(`${customerPath}?view=history`);
  const history = page.getByRole("region", { name: "Customer history" });
  const entries = [
    [
      "Text · Sent — Sent an update about the estimate.",
      "Text shortcut opened",
      "Saved note only",
    ],
    [
      "Text · Received — Customer asked for a callback next week.",
      "Text shortcut opened",
      `Follow up on ${dateLabel}`,
    ],
    [
      "Email · Sent — Emailed the updated estimate.",
      "Email shortcut opened",
      "Task completed",
    ],
  ];
  for (const [summary, shortcut, update] of entries) {
    const entry = history
      .locator("details.contact-history")
      .filter({ hasText: summary });
    await expect(entry).toHaveCount(1);
    await expect(entry.getByText(shortcut, { exact: false })).toBeHidden();
    await entry.locator("summary").click();
    await expect(entry.getByText(shortcut, { exact: false })).toBeVisible();
    await expect(entry.getByText(update, { exact: false })).toBeVisible();
    await expect(entry.getByText("Logged by", { exact: false })).toBeVisible();
  }
  await expect(history.getByText(/^(Text|Email) shortcut opened/)).toHaveCount(
    3,
  );
  await history.getByRole("button", { name: "Log contact" }).click();
  await contact.getByLabel("What happened?").selectOption("received");
  await contact
    .getByLabel("Short summary")
    .fill("Customer replied with a question about parts.");
  await contact.getByRole("button", { name: "Save to history" }).click();
  await expect(history).toContainText(
    "Text · Received — Customer replied with a question about parts.",
  );
  await history.getByRole("button", { name: "Log contact" }).click();
  await contact.getByLabel("Contact method").selectOption("call");
  await contact.getByLabel("What happened?").selectOption("left_message");
  await contact.getByRole("button", { name: "Save to history" }).click();
  await expect(history).toContainText("Call · Left message");
});
