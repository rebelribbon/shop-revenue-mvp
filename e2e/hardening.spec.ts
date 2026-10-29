import {test,expect} from '@playwright/test';
import {createHmac} from 'node:crypto';
import {signInWithPassword} from './helpers';
function totp(secret:string){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of secret.replace(/=/g,''))bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g)!.map(b=>Number.parseInt(b,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',key).update(counter).digest();const offset=h[h.length-1]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
test('owner can download tenant records while staff and anonymous users cannot',async({page},info)=>{
 expect((await page.request.get('/app/settings/export/customers')).status()).toBe(403);
 await signInWithPassword(page,'owner.a@shop-a.test');await page.goto('/app/settings/export');await expect(page.getByRole('heading',{name:'Export shop data',exact:true})).toBeVisible();
 const result=await page.request.get('/app/settings/export/customers');expect(result.status()).toBe(200);expect(result.headers()['content-type']).toContain('application/x-ndjson');expect(result.headers()['cache-control']).toContain('no-store');const text=await result.text();expect(text).not.toContain('tokenHash');expect(JSON.parse(text.split('\n')[0]).format).toBe('shop-revenue-ndjson-v1');
 await signInWithPassword(page,'staff.a@shop-a.test');expect((await page.request.get('/app/settings/export/customers')).status()).toBe(403);
 await page.goto('/app/settings/export');await expect(page).toHaveURL(/\/app\?denied=1/);
 expect((await page.request.get('/api/cron/maintenance')).status()).toBe(503);
 void info;
});
test('authenticator enrollment verifies an actual local-stack TOTP code',async({page})=>{
 await signInWithPassword(page,'owner.b@shop-b.test');await page.goto('/verify?next=/app/settings');
 const setup=page.getByRole('button',{name:'Set up authenticator',exact:true});
 // The local stack is shared by both viewport projects. The first project enrolls;
 // the second verifies that the previously enrolled factor requires a code.
 if(await setup.count()){
  await setup.click();await expect(page.getByAltText('Authenticator enrollment QR code')).toBeVisible();await page.getByText('Enter setup key manually',{exact:true}).click();const secret=(await page.locator('code').textContent())!;await page.getByLabel('Authenticator code').fill(totp(secret));await page.getByRole('button',{name:'Verify authenticator',exact:true}).click();await expect(page).toHaveURL(/\/app\/settings$/);
 }else await expect(page.getByLabel('Authenticator code')).toBeVisible();
});
