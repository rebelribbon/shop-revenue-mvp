import Link from 'next/link';
import {requireOwnerView} from '@/server/views/shop';
import {exportCounts,exportDatasets} from '@/domain/data-export';
import {withTenant} from '@/db/tenant';
export default async function ExportPage(){
 const s=await requireOwnerView('/app/settings/export');
 if(s.actor.type==='support')return <main><h1>Data export</h1><p>Only the shop owner can download customer data.</p></main>;
 const counts=await withTenant(s.businessId,s.actor,exportCounts);
 return <main><p><Link href="/app/settings">← Settings</Link></p><h1>Export shop data</h1><p>Download your records as one JSON object per line. These files contain private customer and financial information; store them securely.</p><p>Sign-in links and credentials are omitted. These downloads are not a restorable backup, and records may change during a download.</p><div className="settings-grid">{exportDatasets.map(d=><a className="card settings-link" href={`/app/settings/export/${d}`} key={d}><strong>{d.replaceAll('-',' ')}</strong><span>{counts[d].toLocaleString()} records · Download NDJSON</span></a>)}</div></main>;
}
