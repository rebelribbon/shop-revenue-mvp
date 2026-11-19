import { expect, test } from "@playwright/test";

test("mobile customer list scrolls above navigation and actions fit the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/demo/crm");
  const main = page.locator("main.crm-sample");
  const nav = page.getByRole("navigation", {
    name: "Mobile sample navigation",
  });
  await expect(nav).toBeVisible();
  await main.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const last = page.locator(".customer-directory-row").last();
  await expect(last).toBeInViewport();
  const lastRect = await last.boundingBox();
  const navRect = await nav.boundingBox();
  expect(lastRect).not.toBeNull();
  expect(navRect).not.toBeNull();
  expect(lastRect!.y + lastRect!.height).toBeLessThanOrEqual(navRect!.y - 8);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);

  await page.goto("/demo/crm?customer=alex");
  const contacts = page.getByRole("group", {
    name: "Contact customer",
    exact: true,
  });
  await expect(contacts.getByRole("link")).toHaveCount(3);
  for (const [name, href] of [
    ["Call", "tel:+12105550100"],
    ["Text", "sms:+12105550100"],
    ["Email", "mailto:alex@example.test"],
  ]) {
    const button = contacts.getByRole("link", { name, exact: true });
    await expect(button).toHaveAttribute("href", href);
    await expect(button).toBeInViewport();
    const bounds = await button.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(48);
    expect(bounds!.height).toBeGreaterThanOrEqual(48);
  }
  const contactBounds = await contacts.boundingBox();
  const nameBounds = await page
    .getByRole("heading", { name: "Alex Example", exact: true })
    .boundingBox();
  expect(contactBounds!.y + contactBounds!.height + 8).toBeLessThanOrEqual(
    nameBounds!.y,
  );
  const actionButtons = page.locator(".customer-hero-actions > .btn");
  await expect(actionButtons).toHaveCount(2);
  for (const button of await actionButtons.all()) {
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  }
});

test("authenticated Add Customer stays in the page flow above the list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { signInWithPassword } = await import("./helpers");
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers");
  const button = page.getByRole("link", { name: "Add customer", exact: true });
  await expect(button).toBeVisible();
  await expect(button).toHaveCSS("position", "static");
  const main = page.locator("main.customer-index-page");
  const contentRect = await main.boundingBox();
  const navigationRect = await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .boundingBox();
  expect(contentRect).not.toBeNull();
  expect(navigationRect).not.toBeNull();
  expect(contentRect!.y + contentRect!.height).toBeLessThanOrEqual(
    navigationRect!.y - 8,
  );
  await main.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const rows = page.locator(".customer-directory-row");
  if (await rows.count()) {
    const lastRect = await rows.last().boundingBox();
    const navRect = await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .boundingBox();
    expect(lastRect).not.toBeNull();
    expect(navRect).not.toBeNull();
    expect(lastRect!.y + lastRect!.height).toBeLessThanOrEqual(navRect!.y - 8);
  }
});

test("authenticated customer shortcuts are icons beside the name", async ({page}) => {
  const { signInWithPassword } = await import("./helpers");
  await page.setViewportSize({width:390,height:844});
  await signInWithPassword(page,"owner.b@shop-b.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("Assigned service advisor").selectOption({index:1});
  await page.getByLabel("First name").fill("Contact");
  await page.getByLabel("Last name").fill("Icon Test");
  await page.getByLabel("Mobile number").fill("+12105550123");
  await page.getByLabel("Email",{exact:true}).fill("contact-icon@example.test");
  await page.getByRole("button",{name:"Add customer",exact:true}).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  const row=page.locator(".customer-hero-title-row");
  await expect(row.getByRole("heading",{name:"Contact Icon Test"})).toBeVisible();
  const contacts=row.getByRole("group",{name:"Contact customer"});
  for(const [name,href] of [
    ["Call","tel:+12105550123"],
    ["Text","sms:+12105550123"],
    ["Email","mailto:contact-icon@example.test"],
  ]) {
    const link=contacts.getByRole("link",{name,exact:true});
    await expect(link).toHaveAttribute("href",href);
    await expect(link.locator("svg")).toHaveCount(1);
    const box=await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
    expect(box!.x+box!.width).toBeLessThanOrEqual(390);
  }
});
