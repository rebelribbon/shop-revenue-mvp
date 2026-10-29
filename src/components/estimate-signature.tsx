"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {signEstimateAction} from "@/server/actions/estimates";
import type {EstimateSnapshot} from "@/db/schema/m3";
const CONSENT="I have reviewed this estimate version. I authorize only the selected items at the displayed prices and decline all unselected items. My typed name is my electronic signature.";
export function EstimateSignature({token,snapshot:s}:{token:string;snapshot:EstimateSnapshot}){
 const [ids,setIds]=useState<string[]>(s.lines.map(l=>l.id));const [pending,setPending]=useState(false);const [message,setMessage]=useState("");const router=useRouter();const subtotal=s.lines.filter(l=>ids.includes(l.id)).reduce((a,l)=>a+l.totalCents,0);const total=subtotal+Math.round(subtotal*s.taxBps/10000);
 return <form className="card" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setPending(true);try{const r=await signEstimateAction({token,name:f.get("name"),ids,consent:f.get("consent")==="on"});if(r.ok){setMessage("Your decision was recorded.");router.refresh();}else setMessage(r.message??"Unable to record decision.");}finally{setPending(false);}}}>
 <h2>Authorize work</h2><p>Select the items you approve. Unselected items will be declined. Clear all items to decline the entire estimate.</p>{s.lines.map(l=><label key={l.id} style={{display:"block"}}><input type="checkbox" checked={ids.includes(l.id)} onChange={e=>setIds(e.target.checked?[...ids,l.id]:ids.filter(id=>id!==l.id))}/> Approve {l.description}</label>)}<p>Authorized total including tax: <strong>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(total/100)}</strong></p>
 <label>Your full name<input name="name" required maxLength={200} autoComplete="name"/></label><label><input name="consent" type="checkbox" required/> {CONSENT}</label><button className="btn primary" disabled={pending}>{pending?"Recording…":ids.length?"Sign authorization":"Sign decline"}</button><p role="status">{message}</p></form>;
}
