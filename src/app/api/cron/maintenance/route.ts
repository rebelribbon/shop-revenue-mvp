import {safeEqual} from '@/lib/tokens';
import {runMaintenanceBatch} from '@/domain/maintenance';
import {safeErrorDiagnostic} from '@/lib/errors';
import {logger} from '@/lib/logger';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(req:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret||secret.length<32)return Response.json({error:'Maintenance is not configured'},{status:503,headers:{'Cache-Control':'no-store'}});
 const authorization=req.headers.get('authorization')??'';
 if(!safeEqual(authorization,`Bearer ${secret}`))return Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
 try{const result=await runMaintenanceBatch();return Response.json(result,{status:result.status==='failed'?503:200,headers:{'Cache-Control':'no-store'}});}catch(error){logger.error({event:'maintenance.route_failed',...safeErrorDiagnostic(error)});return Response.json({error:'Maintenance failed; retry is required'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
