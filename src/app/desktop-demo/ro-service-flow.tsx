"use client";

import { useEffect, useState } from "react";
import styles from "./desktop-demo.module.css";
import { areServiceDocumentsCurrent, type SignedItem } from "./ro-document-guard";

export type ServiceLine = {
  id: number; name: string; decision: "approved" | "pending" | "declined";
  price: number; cost: number | null;
};
type DemoSignature = { name: string; recordedAt: string; version: number; items: number[]; lines: SignedItem[] };
type ServiceRecord = {
  complaint: string; assignedTech: string; diagnosis: string;
  inspection: string; mediaNotes: string;
  partsCost: string; partsPrice: string; laborCost: string; laborPrice: string;
  estimate?: DemoSignature; declination?: DemoSignature; privacy?: DemoSignature;
};
const defaults: ServiceRecord = {
  complaint:"",assignedTech:"",diagnosis:"",inspection:"",mediaNotes:"",
  partsCost:"",partsPrice:"",laborCost:"",laborPrice:"",
};
const keyFor=(ro:string)=>`shop-revenue-desktop-demo-service-flow-v1:${ro}`;
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
export function ServiceFlowDemo({roId,jobs}:{roId:string;jobs:ServiceLine[]}) {
  const [record,setRecord]=useState<ServiceRecord>(defaults);
  const [loaded,setLoaded]=useState(false);
  const [signer,setSigner]=useState("");
  const [selectedDoc,setSelectedDoc]=useState<"estimate"|"declination"|"privacy">("estimate");
  const [noticeAcknowledged,setNoticeAcknowledged]=useState(false);
  const [confirmSign,setConfirmSign]=useState(false);
  const approved=jobs.filter(j=>j.decision==="approved");
  const declined=jobs.filter(j=>j.decision==="declined");
  const pending=jobs.filter(j=>j.decision==="pending");
  const approvedTotal=approved.reduce((n,j)=>n+j.price,0);
  const completedPrices=jobs.every(j=>j.cost!==null);
  const signed=(key:"estimate"|"declination"|"privacy")=>!!record[key];
  const allSigned=areServiceDocumentsCurrent(record,jobs);
  useEffect(()=>{
    let alive=true;let saved:ServiceRecord|null=null;
    try {const raw=sessionStorage.getItem(keyFor(roId));if(raw){const v=JSON.parse(raw) as ServiceRecord;if(typeof v.complaint==="string"&&typeof v.assignedTech==="string")saved=v;}}catch{}
    queueMicrotask(()=>{if(alive){setRecord(saved??defaults);setLoaded(true);}});
    return()=>{alive=false;};
  },[roId]);
  function update(next:ServiceRecord){
    setRecord(next);try{sessionStorage.setItem(keyFor(roId),JSON.stringify(next));}catch{}
    window.dispatchEvent(new Event("shop-revenue-demo-documents-changed"));
  }
  function setField<K extends keyof ServiceRecord>(field:K,value:ServiceRecord[K]){
    update({...record,[field]:value,estimate:undefined,declination:undefined,privacy:undefined});
  }
  function sign(){
    if(!signer.trim()||!confirmSign||!loaded)return;
    if(!record.complaint.trim()||!record.assignedTech.trim()||!record.diagnosis.trim()||!record.inspection.trim())return;
    if(pending.length)return;
    if(selectedDoc==="privacy"&&!noticeAcknowledged)return;
    if(selectedDoc==="declination"&&!declined.length)return;
    if(selectedDoc==="estimate"&&(!approved.length||!completedPrices))return;
    const prev=record[selectedDoc];
    update({...record,[selectedDoc]:{
      name:signer.trim(),recordedAt:new Date().toISOString(),
      version:(prev?.version??0)+1,items:(selectedDoc==="declination"?declined:approved).map(j=>j.id),
      lines:(selectedDoc==="declination"?declined:approved).map(j=>({id:j.id,name:j.name,price:j.price}))
    }});
    setSigner("");setConfirmSign(false);setNoticeAcknowledged(false);
  }
  return <section className={styles.panel} aria-label="Customer complaint, technician diagnosis, advisor estimate and customer documents">
    <div className={styles.panelHeader}>
      <div><h2>RO Intake → Diagnosis → Estimate → Signatures</h2>
        <p>One service record, with distinct customer statements, technician findings, advisor pricing, and signed documents.</p>
      </div>
      <span className={allSigned?styles.approvedTag:styles.pendingTag}>{allSigned?"Documents complete":"Authorization documents pending"}</span>
    </div>
    {!loaded?<p className={styles.vehicleEmpty}>Loading RO record…</p>:<div className={styles.serviceFlowLayout}>
      <section className={styles.serviceFlowStep}><h3>1 · Advisor intake</h3>
        <label>Customer-reported concern (record the customer's words)
          <textarea rows={3} value={record.complaint} maxLength={1000} onChange={e=>setField("complaint",e.target.value)} placeholder="Customer reports squealing brakes when slowing down…"/>
        </label>
      </section>
      <section className={styles.serviceFlowStep}><h3>2 · Technician assessment & inspection</h3>
        <label>Assigned technician<input value={record.assignedTech} onChange={e=>setField("assignedTech",e.target.value)} placeholder="Technician name"/></label>
        <label>Diagnosis and technician notes<textarea rows={3} value={record.diagnosis} onChange={e=>setField("diagnosis",e.target.value)} placeholder="Measured pad thickness; verified concern…"/></label>
        <label>Full multi-point inspection findings<textarea rows={3} value={record.inspection} onChange={e=>setField("inspection",e.target.value)} placeholder="Brakes, tires, fluids, suspension, lighting…"/></label>
        <label>Photo/video references and notes<textarea rows={2} value={record.mediaNotes} onChange={e=>setField("mediaNotes",e.target.value)} placeholder="Uploaded files stay in the RO media gallery for advisor review"/></label>
        <p className={styles.note}>Tech media is managed in the RO media panel. Only advisor-approved evidence becomes customer-visible.</p>
      </section>
      <section className={styles.serviceFlowStep}><h3>3 · Advisor estimate breakdown</h3>
        <p>Illustrative cost breakdown. Actual customer line authorizations and pricing remain attached to the RO work items.</p>
        <div className={styles.serviceFlowCosts}>
          {([["partsCost","Parts cost"],["partsPrice","Parts customer price"],["laborCost","Labor cost"],["laborPrice","Labor customer price"]] as const).map(([field,label])=>
            <label key={field}>{label}<input type="number" min="0" step=".01" value={record[field]} onChange={e=>setField(field,e.target.value)}/></label>)}
        </div>
        <p>Approved work: <strong>{money(approvedTotal)}</strong> · Declined: <strong>{declined.length}</strong> · Undecided: <strong>{pending.length}</strong></p>
      </section>
      <section className={styles.serviceFlowStep}><h3>4 · Customer documents</h3>
        <p>These are three independently recorded demo acknowledgments, not legally binding electronic signatures.</p>
        <div className={styles.serviceDocStatus}>
          <div><strong>Approved estimate</strong><span>{signed("estimate")?"Demo signed":"Awaiting signature"}</span></div>
          <div><strong>Declined recommendations</strong><span>{declined.length===0?"Not applicable":signed("declination")?"Demo signed":"Awaiting signature"}</span></div>
          <div><strong>Privacy notice</strong><span>{signed("privacy")?"Demo signed":"Awaiting signature"}</span></div>
        </div>
        <label>Document to review<select value={selectedDoc} onChange={e=>{setSelectedDoc(e.target.value as typeof selectedDoc);setConfirmSign(false);}}>
          <option value="estimate">Approved estimate</option>
          <option value="declination">Declination of recommended work</option>
          <option value="privacy">Privacy notice acknowledgment</option>
        </select></label>
        {selectedDoc==="estimate"&&<div className={styles.serviceDocPreview}>
          <strong>Estimate · authorized work</strong>
          {approved.map(j=><p key={j.id}>{j.name} · {money(j.price)}</p>)}
          <p><strong>Total before tax/fees: {money(approvedTotal)}</strong></p>
          <p>Approved work must be explicitly authorized before repair begins.</p>
        </div>}
        {selectedDoc==="declination"&&<div className={styles.serviceDocPreview}>
          <strong>Declination · recommendations not authorized</strong>
          {declined.map(j=><p key={j.id}>{j.name} · Declined</p>)}
          {!declined.length&&<p>Nothing declined — this document is not required.</p>}
          <p>This document records a decision not to authorize listed recommended work.</p>
        </div>}
        {selectedDoc==="privacy"&&<div className={styles.serviceDocPreview}>
          <strong>Privacy notice · sample only</strong>
          <p>Service records and relevant personal/contact information are used to manage repair orders, communicate about services, process payments, and retain documents. The production notice must describe actual practices and applicable rights before launch.</p>
          <label className={styles.serviceFlowCheck}><input type="checkbox" checked={noticeAcknowledged} onChange={e=>setNoticeAcknowledged(e.target.checked)}/> I have reviewed this sample notice.</label>
        </div>}
        <label>Customer printed name<input value={signer} onChange={e=>setSigner(e.target.value)} placeholder="Name shown on acknowledgment"/></label>
        <label className={styles.serviceFlowCheck}><input type="checkbox" checked={confirmSign} onChange={e=>setConfirmSign(e.target.checked)}/> I confirm this document selection (demo only).</label>
        <button type="button" className={styles.addButton} onClick={sign} disabled={!confirmSign||!signer.trim()||!!pending.length||(selectedDoc==="estimate"&&(!approved.length||!completedPrices))||(selectedDoc==="declination"&&!declined.length)||(selectedDoc==="privacy"&&!noticeAcknowledged)}>
          Record {selectedDoc} acknowledgment (demo)
        </button>
        {pending.length>0&&<p className={styles.checkoutGuardError}>Finish every recommendation decision before signing the estimate and declination.</p>}
        <p className={styles.note}>In production, freeze the priced estimate and declined items into immutable document versions, capture enforceable e-signature evidence, retain receipts and media per the shop's retention policy, and allow retrieval from the RO.</p>
      </section>
    </div>}
  </section>;
}
