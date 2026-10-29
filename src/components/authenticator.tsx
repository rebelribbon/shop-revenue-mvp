'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {enrollAuthenticator,verifyAuthenticator} from '@/server/actions/mfa';
export function Authenticator({factors,next,verified}:{factors:{id:string;name:string}[];next:string;verified:boolean}){
 const [factorId,setFactor]=useState(factors[0]?.id??''),[qr,setQr]=useState(''),[secret,setSecret]=useState(''),[message,setMessage]=useState('');
 const [pending,start]=useTransition();const router=useRouter();
 return <section className="card"><h1>{verified?'Authenticator verified':'Verify your sign-in'}</h1>
  <p>Use an authenticator app you control. Keep access to that app; contact support if it is lost.</p>
  {verified?<button className="btn primary" onClick={()=>{router.push(next);router.refresh();}}>Continue to workspace</button>:<>
   {!factorId&&<button className="btn primary" disabled={pending} onClick={()=>start(async()=>{try{const r=await enrollAuthenticator();if(!r.ok)setMessage(r.message);else{setFactor(r.factorId);setQr(r.qrCode);setSecret(r.secret);}}catch{setMessage('Authenticator setup is unavailable. Try again.');}})}>Set up authenticator</button>}
   {qr&&<><p>Scan this code with your authenticator app, then enter its current six-digit code.</p>{/* The QR contains an enrollment secret. Never send it to an external image service. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img width={220} height={220} alt="Authenticator enrollment QR code" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`}/>
    <details><summary>Enter setup key manually</summary><code style={{overflowWrap:'anywhere'}}>{secret}</code></details>
   </>}
   {factorId&&<form onSubmit={e=>{e.preventDefault();const code=String(new FormData(e.currentTarget).get('code')??'');start(async()=>{try{const r=await verifyAuthenticator({factorId,code});if(!r.ok)setMessage(r.message);else{setQr('');setSecret('');router.push(next);router.refresh();}}catch{setMessage('Verification is unavailable. Your code was not saved.');}});}}>
    {factors.length>1&&<label>Authenticator<select value={factorId} onChange={e=>setFactor(e.target.value)}>{factors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
    <label htmlFor="mfa-code">Authenticator code</label><input id="mfa-code" name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/>
    <button className="btn primary" disabled={pending}>{pending?'Verifying…':'Verify authenticator'}</button>
   </form>}
  </>}
  <p role="status">{message}</p><form action="/auth/sign-out" method="post"><button className="btn secondary">Sign out</button></form>
 </section>;
}
