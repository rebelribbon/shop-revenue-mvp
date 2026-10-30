"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { WorkspaceIcon } from "./workspace-icon";

export function QuickFind({automotive}:{automotive:boolean}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const input=useRef<HTMLInputElement>(null);
 const open=useCallback(()=>{
  if(!dialog.current?.open)dialog.current?.showModal();
  input.current?.focus();input.current?.select();
 },[]);
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='k')return;
   const other=document.querySelector('dialog[open]');
   if(other&&other!==dialog.current)return;
   event.preventDefault();open();
  };
  document.addEventListener('keydown',onKey);
  return ()=>document.removeEventListener('keydown',onKey);
 },[open]);
 return <>
  <button type="button" className="btn secondary quick-find-trigger" aria-label="Quick find" aria-keyshortcuts="Control+k Meta+k" aria-haspopup="dialog" onClick={open}>
   <WorkspaceIcon name="search"/><span className="quick-find-desktop-label">Find a customer or record…</span><span className="quick-find-mobile-label">Search</span><kbd>Ctrl / ⌘ K</kbd>
  </button>
  <dialog ref={dialog} className="quick-find" aria-labelledby="quick-find-heading">
   <div className="section-heading"><h2 id="quick-find-heading">Quick find</h2><button type="button" className="btn secondary compact-btn" onClick={()=>dialog.current?.close()}><WorkspaceIcon name="close"/>Close</button></div>
   <p className="muted">Search your customer records or jump straight to a workspace.</p>
   <div className="quick-find-links" aria-label="Workspace shortcuts">
    {([['/app/customers','Customers'],['/app/jobs','Jobs'],['/app/estimates','Estimates'],['/app/invoices','Invoices'],['/app/opportunities','Money Finder']] as const).map(([href,label])=><Link key={href} className="btn secondary" href={href} onClick={()=>dialog.current?.close()}>{label}</Link>)}
   </div>
   <form action="/app/customers" method="get">
    <label htmlFor="workspace-query">{automotive?'Search customers and vehicles':'Search customers, properties and equipment'}</label>
    <input ref={input} id="workspace-query" name="q" required maxLength={100} placeholder={automotive?'Name, phone, email, plate or last 6 VIN':'Name, phone, address or equipment serial'}/>
    <button className="btn primary" data-page-primary type="submit">Search</button>
   </form>
  </dialog>
 </>;
}
