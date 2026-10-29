import {describe,it,expect,vi} from 'vitest';
const run=vi.hoisted(()=>vi.fn(async()=>({status:'succeeded',completed:1,failed:0})));
vi.mock('@/domain/maintenance',()=>({runMaintenanceBatch:run}));
import {GET} from '@/app/api/cron/maintenance/route';
describe('maintenance authentication',()=>{
 it('fails closed without a long secret and never executes a task',async()=>{delete process.env.CRON_SECRET;run.mockClear();const r=await GET(new Request('https://shop.test/api/cron/maintenance'));expect(r.status).toBe(503);expect(run).not.toHaveBeenCalled();});
 it('requires exact bearer authorization, never accepts a query token',async()=>{process.env.CRON_SECRET='test-maintenance-secret-at-least-32-characters';run.mockClear();expect((await GET(new Request('https://shop.test/api/cron/maintenance?secret='+process.env.CRON_SECRET))).status).toBe(401);expect(run).not.toHaveBeenCalled();expect((await GET(new Request('https://shop.test/api/cron/maintenance',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}}))).status).toBe(200);expect(run).toHaveBeenCalledOnce();});
});
