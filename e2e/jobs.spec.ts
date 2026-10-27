import {test,expect} from "@playwright/test";
import {signInWithPassword} from "./helpers";
test("prices and saves an internal job sheet",async({page},info)=>{
 await signInWithPassword(page,"owner.a@shop-a.test");
 await page.goto("/app/customers");await page.getByLabel("First name").fill(`Job ${info.project.name}`);await page.getByRole("button",{name:"Add customer",exact:true}).click();await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
 await page.getByLabel("Make",{exact:true}).fill("Honda");await page.getByRole("button",{name:"Add vehicle",exact:true}).click();await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
 await page.goto("/app/jobs");await page.getByLabel("Job name").fill(`Brakes ${info.project.name}`);await page.getByLabel("Customer",{exact:true}).selectOption({label:`Job ${info.project.name}`});await page.getByLabel("Vehicle",{exact:true}).selectOption({label:"Honda"});
 await page.getByRole("button",{name:"Add part",exact:true}).click();await page.getByLabel("Description",{exact:true}).fill("Pads");await page.getByLabel("Unit cost",{exact:true}).fill("100");await page.getByLabel("Unit selling price",{exact:true}).fill("200");await expect(page.getByText("Quoted subtotal:",{exact:false}).first()).toContainText("$200.00");
 await page.getByRole("button",{name:"Save job sheet",exact:true}).click();await expect(page.getByRole("status")).toContainText("Job sheet saved");await page.reload();await expect(page.getByRole("heading",{name:`Brakes ${info.project.name}`,exact:true})).toBeVisible();
});
