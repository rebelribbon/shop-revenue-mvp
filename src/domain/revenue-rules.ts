// Versioned rules for the manual-contact product. No tracking-link or delivery
// telemetry is inferred from a phone/email link, document view or payment.
export const REVENUE_RULE_VERSION = 'manual-v1';
export const WINDOWS = { interactionDays: 30, completionDays: 60, influencedDays: 45, unpaidDays: 14, workDays: 30 } as const;
const day=86400000;
export type RevenueContact={id:string;recoveryId:string;customerId:string;vehicleId:string|null;category:string;subjectId:string;at:string;delivered:boolean;recommendationIds:string[]};
export type RevenueResponse={id:string;contactId:string;at:string;ownerConfirmed:boolean};
export type RevenuePayment={id:string;amountCents:number;at:string;reversesPaymentId:string|null};
export type RevenueInvoice={id:string;customerId:string;vehicleId:string|null;versionId:string;quoteId:string;authorizationId:string;authorizedAt:string;createdAt:string;workCreatedAt:string;
 sourceRecoveryItemId:string|null;sourceContactActivityId:string|null;sourceAppointmentId:string|null;
 voided:boolean;disputed:boolean;totalCents:number;subtotalCents:number;
 lines:{id:string;totalCents:number;recommendationId?:string}[];payments:RevenuePayment[]};
export type RevenueDecision={classification:'direct'|'influenced'|'none';ruleCode:string;contactId:string|null;responseId:string|null;recoveryId:string|null;amountCents:number;countedSubtotalCents:number;otherSubtotalCents:number;paymentIds:string[];lineIds:string[];explanation:string;documentEvidence?:{invoiceId:string;versionId:string;quoteId:string;authorizationId:string;appointmentId:string|null};calculation?:{invoiceTotalCents:number;countedSubtotalCents:number;netEligiblePaidCents:number;rounding:string}};
const time=(s:string)=>new Date(s).getTime();
const within=(at:string,start:string,days:number)=>time(at)>=time(start)&&time(at)<=time(start)+days*day;
export function pretaxShare(subtotal:number,paid:number,total:number){
 if(![subtotal,paid,total].every(Number.isSafeInteger)||subtotal<0||paid<0||total<=0)throw new Error('Invalid attribution amounts');
 const net=BigInt(Math.min(paid,total)),den=BigInt(total);
 return Number((BigInt(subtotal)*net+den/BigInt(2))/den);
}
function netPayments(i:RevenueInvoice,eligible:(p:RevenuePayment)=>boolean){
 const positive=i.payments.filter(p=>p.amountCents>0&&eligible(p));
 const ids=new Set(positive.map(p=>p.id));
 const adjustments=i.payments.filter(p=>p.amountCents<0&&p.reversesPaymentId&&ids.has(p.reversesPaymentId));
 const amount=positive.reduce((n,p)=>n+BigInt(p.amountCents),BigInt(0))+adjustments.reduce((n,p)=>n+BigInt(p.amountCents),BigInt(0));
 return {amount:Number(amount<BigInt(0)?BigInt(0):amount>BigInt(i.totalCents)?BigInt(i.totalCents):amount),ids:[...positive,...adjustments].map(p=>p.id).sort()};
}
function scopedLines(i:RevenueInvoice,c:RevenueContact){
 if(c.category==='declined')return i.lines.filter(l=>l.recommendationId&&c.recommendationIds.includes(l.recommendationId));
 if(c.category==='open_estimate')return c.subjectId===i.versionId?i.lines:[];
 if(c.category==='unpaid_invoice')return c.subjectId===i.id?i.lines:[];
 return c.category==='lapsed'||c.category==='service_due'?i.lines:[];
}
const none=(i:RevenueInvoice,reason='No qualifying recorded contact and work chain.'):RevenueDecision=>({classification:'none',ruleCode:'NONE',contactId:null,responseId:null,recoveryId:null,amountCents:0,countedSubtotalCents:0,otherSubtotalCents:i.subtotalCents,paymentIds:[],lineIds:[],explanation:reason});
function decide(i:RevenueInvoice,c:RevenueContact,r:RevenueResponse|undefined,kind:'direct'|'influenced'):RevenueDecision|null{
 const lines=scopedLines(i,c),counted=lines.reduce((n,l)=>n+l.totalCents,0);
 if(counted<=0)return null;
 const unpaid=c.category==='unpaid_invoice';
 const eligible=(p:RevenuePayment)=>kind==='influenced'?time(p.at)>=time(c.at):
   unpaid?within(p.at,r!.at,WINDOWS.unpaidDays)&&time(p.at)>=time(c.at):within(p.at,r!.at,WINDOWS.completionDays)&&time(p.at)>=time(i.authorizedAt);
 const net=netPayments(i,eligible);if(net.amount<=0)return null;
 const amount=pretaxShare(counted,net.amount,i.totalCents);if(amount<=0)return null;
 const ruleCode=kind==='influenced'?'I-RETURN':unpaid?'D-UNPAID':c.category==='open_estimate'?'D-ESTIMATE':c.category==='declined'?'D-DECLINED':'D-VISIT';
 return {classification:kind,ruleCode,contactId:c.id,responseId:r?.id??null,recoveryId:c.recoveryId,amountCents:amount,countedSubtotalCents:counted,otherSubtotalCents:i.subtotalCents-counted,paymentIds:net.ids,lineIds:lines.map(l=>l.id).sort(),documentEvidence:{invoiceId:i.id,versionId:i.versionId,quoteId:i.quoteId,authorizationId:i.authorizationId,appointmentId:i.sourceAppointmentId},calculation:{invoiceTotalCents:i.totalCents,countedSubtotalCents:counted,netEligiblePaidCents:net.amount,rounding:'half-up to the cent'},
  explanation:kind==='direct'?`${ruleCode}: a recorded manual contact, owner-confirmed response, ${unpaid?'payment on the subject invoice':'linked authorized work'}, and recorded payments within the rule window. Before-tax credit uses only the counted lines and their net paid share.`:
  `I-RETURN: shop-confirmed contact delivery; this is the first eligible paid invoice issued within 45 days. No qualifying direct chain is established. Influenced only; not counted as recovered.`};
}
export function evaluateRevenue(invoices:RevenueInvoice[],contacts:RevenueContact[],responses:RevenueResponse[],excluded=new Set<string>()){
 const results=new Map<string,RevenueDecision>();
 const influencedCandidates=new Map<string,RevenueDecision[]>();
 for(const i of invoices){
  if(i.voided||i.disputed||excluded.has(i.id)){results.set(i.id,none(i,i.voided?'Invoice voided.':i.disputed?'Open dispute: credit paused.':'Owner marked this invoice not from the recorded follow-up.'));continue;}
  const relevant=contacts.filter(c=>c.customerId===i.customerId&&(!c.vehicleId||c.vehicleId===i.vehicleId));
  const direct: {decision:RevenueDecision;response:RevenueResponse;contact:RevenueContact}[]=[];
  for(const c of relevant){
   for(const r of responses.filter(r=>r.contactId===c.id&&r.ownerConfirmed&&within(r.at,c.at,WINDOWS.interactionDays))){
    if(c.category==='unpaid_invoice'){
     if(c.subjectId!==i.id)continue;
    }else if(c.category==='open_estimate'){
     if(c.subjectId!==i.versionId||time(i.authorizedAt)<time(r.at))continue;
    }else{
     if(i.sourceRecoveryItemId!==c.recoveryId||i.sourceContactActivityId!==c.id||!within(i.workCreatedAt,r.at,WINDOWS.workDays)||time(i.authorizedAt)<time(r.at))continue;
    }
    const decision=decide(i,c,r,'direct');if(decision)direct.push({decision,response:r,contact:c});
   }
  }
  direct.sort((a,b)=>time(b.response.at)-time(a.response.at)||time(b.contact.at)-time(a.contact.at)||b.contact.id.localeCompare(a.contact.id));
  if(direct[0]){results.set(i.id,direct[0].decision);continue;}
  const candidates=relevant.filter(c=>c.delivered&&within(i.createdAt,c.at,WINDOWS.influencedDays)).sort((a,b)=>time(b.at)-time(a.at)||b.id.localeCompare(a.id))
   .map(c=>decide(i,c,undefined,'influenced')).filter((d):d is RevenueDecision=>!!d);
  influencedCandidates.set(i.id,candidates);results.set(i.id,none(i));
 }
 // Each delivery can influence only its first eligible invoice. A later invoice
 // does not fall back to an older delivery after the latest one has been used.
 const used=new Set<string>();
 for(const i of [...invoices].sort((a,b)=>time(a.createdAt)-time(b.createdAt)||a.id.localeCompare(b.id))){
  const candidate=influencedCandidates.get(i.id)?.[0];
  if(candidate&&!used.has(candidate.contactId!)){used.add(candidate.contactId!);results.set(i.id,candidate);}
 }
 return results;
}
