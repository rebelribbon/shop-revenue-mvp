import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("UX standards across public, shop, detail and admin pages",async({page},info)=>{
 test.setTimeout(180_000);
 for(const path of ['/sign-in','/forgot-password','/admin/sign-in','/invite/not-a-valid-token','/not-a-real-page']){
  await page.goto(path);await auditUX(page);
 }
 await signInWithPassword(page,'owner.a@shop-a.test');
 for(const path of ['/app','/app/work','/app/new','/app/customers','/app/jobs','/app/estimates','/app/invoices','/app/schedule','/app/revenue','/app/settings','/app/settings/business','/app/settings/team','/app/settings/support-access','/app/settings/payments','/app/settings/export']){
  await page.goto(path);await auditUX(page);
 }
 await page.goto('/app/customers');
 const name=`UX ${info.project.name} ${Date.now()}`;
 await page.getByLabel('First name',{exact:true}).fill(name);
 await page.getByRole('button',{name:'Add customer',exact:true}).click();
 await expect(page).toHaveURL(/\/customers\/[a-f0-9-]+$/);
 await auditUX(page);
 await page.getByLabel('Make',{exact:true}).fill('UX vehicle');
 await page.getByRole('button',{name:'Add vehicle',exact:true}).click();
 await expect(page).toHaveURL(/\/vehicles\/[a-f0-9-]+$/);
 await auditUX(page);
 await page.goto('/app');
 await page.screenshot({path:`test-results/ux-home-${info.project.name}.png`,fullPage:true});
 if(info.project.name==='desktop'){
  await page.emulateMedia({colorScheme:'dark'});await auditUX(page);
  await page.screenshot({path:'test-results/ux-home-dark.png',fullPage:true});
  await page.emulateMedia({colorScheme:'light'});
 }
 await page.request.post('/auth/sign-out');
 await signInWithPassword(page,'admin.one@example.test','/admin/sign-in');
 for(const path of ['/admin','/admin/release','/admin/policies','/admin/webhooks','/admin/help']){await page.goto(path);await auditUX(page);}
 await page.goto('/admin');
 const tenant=page.locator('tbody a').first();await tenant.click();await auditUX(page);
});

test("core pages stay within three homepage clicks and primary actions follow the active form",async({page})=>{
 await signInWithPassword(page,'owner.a@shop-a.test');
 await page.getByRole('link',{name:'Work',exact:true}).click();
 await page.getByRole('link',{name:'Jobs & costing',exact:false}).click();
 await expect(page).toHaveURL(/\/app\/jobs$/);
 await page.getByLabel('Job name',{exact:true}).focus();
 await expect(page.locator('[data-ux-primary]')).toHaveText('Save job sheet');
 await page.locator('main').evaluate(e=>e.scrollTo(0,e.scrollHeight));
 await expect(page.locator('[data-ux-primary]')).toBeInViewport();
 await auditUX(page);
 await page.goto('/app');await page.getByRole('link',{name:'Settings',exact:true}).click();
 await page.getByRole('link',{name:'Business profile',exact:false}).click();
 await page.getByRole('link',{name:'Set up online payments',exact:true}).click();
 await expect(page).toHaveURL(/\/app\/settings\/payments$/);
});
