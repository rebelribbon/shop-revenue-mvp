import {notFound} from "next/navigation";
import {readPublicEstimate} from "@/domain/estimates";
import {EstimateDocument} from "@/components/estimate-document";
import {EstimateSignature} from "@/components/estimate-signature";
export const dynamic="force-dynamic";
export const metadata={title:"Review estimate | Shop Revenue",robots:{index:false,follow:false}};
export default async function PublicEstimatePage({params}:{params:Promise<{token:string}>}){const {token}=await params;const e=await readPublicEstimate(token);if(!e)notFound();return <main><h1>Estimate · Version {e.version}</h1><EstimateDocument snapshot={e.snapshot}/>{e.authorization?<section className="card"><h2>Decision recorded</h2><p>Signed by {e.authorization.signerName} on {new Date(e.authorization.signedAt).toLocaleString("en-US",{timeZone:"America/Chicago"})}</p><ul>{e.snapshot.lines.map(l=><li key={l.id}>{l.description}: {e.authorization!.approvedLineIds.includes(l.id)?"Approved":"Declined"}</li>)}</ul><p>{e.authorization.consentText}</p></section>:<EstimateSignature token={token} snapshot={e.snapshot}/>}</main>;}
