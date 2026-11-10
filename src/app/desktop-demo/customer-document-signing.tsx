"use client";

import { useEffect, useState } from "react";
import type { CustomerLine } from "./customer-mobile-flow";
import styles from "./desktop-demo.module.css";

type SignatureKey = "estimate" | "declination" | "privacy";
type Signature = {
  name:string;recordedAt:string;version:number;items:number[];
  lines:{id:number;name:string;price:number}[];
};
type RecordData = {
  stage?:string;estimateSentAt?:string;estimate?:Signature;
  declination?:Signature;privacy?:Signature;history?:string[];
};
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const equal=(a:{id:number;name:string;price:number}[],b:{id:number;name:string;price:number}[])=>
  a.length===b.length && a.every(line=>b.some(other=>other.id===line.id && other.name===line.name && other.price===line.price));

export function CustomerDocumentSigning({
  roId,jobs,
}:{
  roId:string;jobs:CustomerLine[];
}) {
  const approved=jobs.filter(j=>j.decision==="approved").map(({id,name,price})=>({id,name,price}));
  const declined=jobs.filter(j=>j.decision==="declined").map(({id,name,price})=>({id,name,price}));
  const [record,setRecord]=useState<RecordData|null>(null);
  const [active,setActive]=useState<SignatureKey>("estimate");
  const [signer,setSigner]=useState("");
  const [checked,setChecked]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const sequence:SignatureKey[]=declined.length?["estimate","declination","privacy"]:["estimate","privacy"];
  const key=`shop-revenue-desktop-demo-service-flow-v1:${roId}`;
  useEffect(()=>{
    let alive=true;let prior:RecordData|null=null;
    try {const raw=sessionStorage.getItem(key); if(raw)prior=JSON.parse(raw) as RecordData;}catch{}
    queueMicrotask(()=>{if(alive){setRecord(prior);setLoaded(true);}});
    return()=>{alive=false;};
  },[key]);
  function valid(doc:SignatureKey){
    const signed=record?.[doc];
    if(!signed?.name.trim() || !signed.recordedAt) return false;
    return doc==="privacy" || equal(signed.lines??[],doc==="declination"?declined:approved);
  }
  const allDone=sequence.every(valid);
  const lines=active==="privacy"?[]:active==="estimate"?approved:declined;
  function sign() {
    if(!record?.estimateSentAt || !signer.trim() || !checked || valid(active))return;
    if(active==="declination" && !valid("estimate"))return;
    if(active==="privacy" && (!valid("estimate") || (declined.length>0 && !valid("declination"))))return;
    const before=record[active];
    const signature:Signature={
      name:signer.trim(),recordedAt:new Date().toISOString(),
      version:(before?.version??0)+1,
      items:lines.map(l=>l.id),lines:lines.map(l=>({...l})),
    };
    const next:RecordData={...record,[active]:signature,
      history:[...(record.history??[]),`Customer acknowledged ${active} in demo · ${signature.recordedAt}`]};
    try {sessionStorage.setItem(key,JSON.stringify(next));}catch{}
    setRecord(next);setSigner("");setChecked(false);
    window.dispatchEvent(new Event("shop-revenue-demo-documents-changed"));
    const index=sequence.indexOf(active);
    if(index<sequence.length-1)setActive(sequence[index+1]);
  }
  if(!loaded)return <p>Loading customer documents…</p>;
  if(!record?.estimateSentAt)return <p>Documents appear after the advisor prepares and shares the estimate.</p>;
  return <section className={styles.customerSigning} aria-labelledby="signing-heading">
    <div className={styles.journeySectionHead}><span className={styles.journeyNumber}>5</span>
      <div><h2 id="signing-heading">Sign your documents</h2><p>Review each applicable acknowledgment separately.</p></div>
    </div>
    <div className={styles.customerSigningSteps}>
      {sequence.map((doc,i)=><button key={doc} type="button" onClick={()=>setActive(doc)}
        className={active===doc?styles.customerSigningActive:""}>
        {valid(doc)?"✓ ":i+1+". "}{doc==="estimate"?"Estimate":doc==="declination"?"Declined work":"Privacy"}
      </button>)}
    </div>
    {allDone ? <div className={styles.journeyDone}>
      <strong>✓ All required documents recorded in demo</strong>
      <p>Approved work is ready to enter the technician queue. These are not legally binding signatures.</p>
    </div>:<div className={styles.customerSigningBody}>
      <h3>{active==="estimate"?"Approved-work estimate":active==="declination"?"Declined-work acknowledgment":"Privacy notice"}</h3>
      {active==="privacy" ? <p>Sample notice: service and contact information is used to manage repairs, provide updates, process payments and retain related records. The actual business notice must accurately describe its data practices and applicable rights.</p>:
        <div className={styles.customerSigningLines}>{lines.map(line=><p key={line.id}><span>{line.name}</span><strong>{active==="estimate"?money(line.price):"Declined"}</strong></p>)}
          {active==="estimate"&&<p><strong>Approved subtotal</strong><strong>{money(lines.reduce((n,l)=>n+l.price,0))}</strong></p>}
        </div>}
      {valid(active)?<div className={styles.journeyDone}>✓ Already acknowledged: {record[active]?.name} · {new Date(record[active]!.recordedAt).toLocaleString()}</div>:
        <>
          <label>Your printed name<input value={signer} onChange={e=>setSigner(e.target.value)} maxLength={100} autoComplete="name" placeholder="First and last name"/></label>
          <label className={styles.journeyCheck}><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>
            {active==="estimate"?"I authorize only the listed approved services.":active==="declination"?"I acknowledge declining the listed recommendations.":"I have reviewed this privacy notice."}
          </label>
          <button type="button" className={styles.mobilePrimaryButton}
            disabled={!signer.trim()||!checked || (active==="declination"&&!valid("estimate")) || (active==="privacy"&&(!valid("estimate") || (declined.length>0&&!valid("declination"))))}
            onClick={sign}>Record {active} acknowledgment (demo) →</button>
        </>
      }
    </div>}
    <p className={styles.journeyDemoDisclaimer}>Preview only. This is not an enforceable e-signature; it does not create a signed PDF, send documents, or store records on the server.</p>
  </section>;
}
