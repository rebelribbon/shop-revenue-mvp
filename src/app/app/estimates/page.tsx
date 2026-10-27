import {EstimateLink} from "@/components/estimate-publisher";
import Link from "next/link";
import {withTenant} from "@/db/tenant";
import {listEstimates} from "@/domain/estimates";
import {requireShopSession} from "@/server/views/shop";
import {AuthorizedTotal,EstimateDocument} from "@/components/estimate-document";
import {ActionForm} from "@/components/action-form";
import {revokeEstimateAction} from "@/server/actions/estimates";
export default async function EstimatesPage(){const s=await requireShopSession("/app/estimates");const rows=await withTenant(s.businessId,s.actor,tx=>listEstimates(tx));return <main><h1>Estimates &amp; authorization</h1><p><Link href="/app/jobs">Create or revise a job to publish an estimate</Link></p>{!rows.length&&<p>No estimates published yet.</p>}{rows.map(e=><article className="card" key={e.id}><h2>{e.snapshot.title} · Version {e.version}</h2><p>{e.revokedAt?"Link revoked / superseded":new Date()>e.expiresAt?"Link expired":"Link active"}</p>{e.supplementReason&&<p>Change: {e.supplementReason}</p>}<EstimateDocument snapshot={e.snapshot}/>{e.authorization?<section><h3>Authorization history</h3><AuthorizedTotal snapshot={e.snapshot} ids={e.authorization.approvedLineIds}/><p>Signed by {e.authorization.signerName} · {e.authorization.createdAt.toLocaleString("en-US",{timeZone:"America/Chicago"})}</p><ul>{e.snapshot.lines.map(l=><li key={l.id}>{l.description}: {e.authorization!.approvedLineIds.includes(l.id)?"Approved":"Declined"}</li>)}</ul><p>{e.authorization.consentText}</p></section>:<p>Awaiting customer decision</p>}{!e.revokedAt&&<EstimateLink id={e.id}/>}
{!e.revokedAt&&<ActionForm action={revokeEstimateAction} hidden={{id:e.id}} submitLabel="Revoke customer link" variant="danger" confirm="Revoke this estimate link? Existing signature evidence is retained."/>}</article>)}</main>;}
