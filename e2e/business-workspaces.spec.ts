import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";

test("home-service setup creates a real property and equipment job without vehicle fields",async({page},info)=>{
 await signInWithPassword(page,"owner.a@shop-a.test");
 await page.goto("/app/settings/business");
 await page.getByLabel("What line of business are you in?").selectOption("hvac");
 await page.getByRole("button",{name:"Save business profile",exact:true}).click();
 await expect(page.getByRole("status")).toContainText("Business profile updated");
 try {
  const name=`HVAC ${info.project.name} ${Date.now()}`;
  await page.goto("/app/customers#new-customer");
  await page.getByLabel("First name",{exact:true}).fill(name);
  await page.getByRole("button",{name:"Add customer",exact:true}).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading",{name:"Vehicles",exact:true})).not.toBeVisible();
  const property=page.locator("#new-property");
  await property.getByLabel("Property name",{exact:true}).fill("Main residence");
  await property.getByLabel("Street address",{exact:true}).fill("456 Service Lane");
  await property.getByLabel("City",{exact:true}).fill("Cibolo");
  await property.getByRole("button",{name:"Add property",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Main residence",exact:true})).toBeVisible();
  const equipment=page.locator("#new-equipment");
  await equipment.getByLabel("Equipment name",{exact:true}).fill("Upstairs AC");
  await equipment.getByLabel("Property",{exact:true}).selectOption({label:"Main residence"});
  await equipment.getByLabel("Manufacturer",{exact:true}).fill("Carrier");
  await equipment.getByLabel("Serial number",{exact:true}).fill("HVAC-TEST-42");
  await equipment.getByRole("button",{name:"Add equipment",exact:true}).click();
  const card=page.getByRole("heading",{name:"Upstairs AC",exact:true}).locator("..");
  await expect(card).toContainText("HVAC-TEST-42");
  await card.getByRole("link",{name:"Create job / estimate",exact:true}).click();
  await expect(page.getByLabel("Property / equipment",{exact:true})).toHaveValue(/^[a-f0-9-]{36}$/);
  await expect(page.getByLabel("Vehicle",{exact:true})).not.toBeVisible();
  await page.getByLabel("Job name",{exact:true}).fill(`AC repair ${info.project.name}`);
  await page.getByRole("button",{name:"Add material",exact:true}).click();
  await page.getByLabel("Description",{exact:true}).fill("Capacitor");
  await page.getByLabel("Unit cost",{exact:true}).fill("20");
  await page.getByLabel("Unit selling price",{exact:true}).fill("100");
  await page.getByRole("button",{name:"Save job sheet",exact:true}).click();
  const saved=page.getByRole("heading",{name:`AC repair ${info.project.name}`,exact:true}).locator("..");
  await expect(saved).toBeVisible();
  await saved.getByRole("button",{name:"Freeze and publish estimate",exact:true}).click();
  const link=saved.getByRole("link",{name:"Open customer estimate",exact:true});
  await expect(link).toBeVisible();
  await page.screenshot({path:`test-results/home-service-${info.project.name}.png`,fullPage:true});
  await page.goto((await link.getAttribute("href"))!);
  await expect(page.getByText(/Upstairs AC, Main residence, 456 Service Lane/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Unit cost");
 } finally {
  await page.goto("/app/settings/business");
  await page.getByLabel("What line of business are you in?").selectOption("automotive");
  await page.getByRole("button",{name:"Save business profile",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Business profile updated");
 }
});
