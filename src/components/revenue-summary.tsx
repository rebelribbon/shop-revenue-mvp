import Link from 'next/link';
export const revenueMoney=(value:number|string)=>{
 const n=Number(value);return Number.isSafeInteger(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100):'Amount unavailable';
};
export function RevenueSummary({direct,influenced,month}:{direct:string;influenced:string;month:string}){
 return <section className="card revenue-summary" aria-label="Recovered revenue">
  <p className="eyebrow">Recovered revenue · {month}</p><h2>{revenueMoney(direct)} directly recovered</h2>
  <p className="muted">Influenced: {revenueMoney(influenced)} — separate, not counted as recovered.</p>
  <p className="muted">Before tax. Net recorded payment shares and corrections posted this month in your shop timezone; refunds and reversals can reduce this amount.</p>
  <Link href="/app/revenue">View attribution and evidence</Link>
 </section>;
}
