"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {freezeEstimateAction} from "@/server/actions/estimates";
export function EstimatePublisher({jobId,version}:{jobId:string;version:string}){
 const [message,setMessage]=useState("");const [path,setPath]=useState("");const [pending,setPending]=useState(false);const [requestId,setRequestId]=useState(()=>crypto.randomUUID());const router=useRouter();
 return <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setPending(true);try{const result=await freezeEstimateAction({jobId,expectedJobVersion:version,taxBps:Math.round(Number(f.get("taxPercent"))*100),terms:String(f.get("terms")??""),supplementReason:String(f.get("supplementReason")??""),clientRequestId:requestId});if(result.ok){const data=result.data as {path?:string};setPath(data.path??"");setMessage("Frozen estimate published. Copy the customer link before leaving this page.");setRequestId(crypto.randomUUID());router.refresh();}else setMessage(result.error.message);}finally{setPending(false);}}}>
 <h4>Publish customer estimate</h4><label>Tax rate (%)<input name="taxPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" required/></label><p className="muted">Applied to the selected work subtotal. Enter the rate appropriate for this estimate.</p>
 <label>Customer terms<textarea name="terms" maxLength={5000} rows={3}/></label><label>Change / supplement reason<textarea name="supplementReason" maxLength={2000} rows={2}/></label><p className="muted">A new version replaces the prior link and requires fresh authorization. Earlier signatures remain in history.</p>
 <button className="btn primary" disabled={pending}>{pending?"Publishing…":"Freeze and publish estimate"}</button><p role="status">{message}</p>{path&&<p><a href={path} target="_blank" rel="noreferrer">Open customer estimate</a><br/><label>Customer link<input readOnly value={`${window.location.origin}${path}`} onFocus={e=>e.currentTarget.select()}/></label></p>}</form>;
}
