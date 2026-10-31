"use client";
import Link from "next/link";
import { WorkspaceIcon } from "./workspace-icon";
import { usePathname } from "next/navigation";
const shopItems = [
  {href:"/app",label:"Home",mobile:"Home",icon:"home"},
  {href:"/app/customers",label:"Customers",mobile:"Customers",icon:"customers"},
  {href:"/app/work",label:"Work",mobile:"Work",icon:"work"},
  {href:"/app/schedule",label:"Schedule",mobile:"Visits",icon:"schedule"},
  {href:"/app/settings",label:"Settings",mobile:"Setup",icon:"settings"},
] as const;
const workPaths=["/app/jobs","/app/estimates","/app/invoices"];
export function WorkspaceNavigation({mobile=false}:{mobile?:boolean}) {
  const path=usePathname();
  return <nav className={mobile?"mobile-nav shop-mobile-nav":"desktop-nav workspace-nav"} aria-label={mobile?"Mobile navigation":"Main"}>
    {(mobile?shopItems.slice(0,4):shopItems).map(item=><Link key={item.href} href={item.href} aria-label={item.label} aria-current={(item.href==="/app"?(path===item.href||path.startsWith("/app/opportunities")||path.startsWith("/app/revenue")):path.startsWith(item.href)||(item.href==="/app/work"&&workPaths.some(p=>path.startsWith(p))))?"page":undefined}>{!mobile&&<WorkspaceIcon name={item.icon}/>}<span>{mobile?item.mobile:item.label}</span></Link>)}
  </nav>;
}
export function AdminNavigation({isAdmin,mobile=false}:{isAdmin:boolean;mobile?:boolean}) {
  const path=usePathname();
  const items=[{href:"/admin",label:"Tenants"},{href:"/admin/release",label:"Readiness"},...(isAdmin?[{href:"/admin/policies",label:"Policies"},{href:"/admin/webhooks",label:"Webhooks"}]:[]),{href:"/admin/help",label:"Help"}];
  return <nav className={mobile?"mobile-nav admin-mobile-nav":"desktop-nav"} aria-label={mobile?"Admin mobile navigation":"Admin"}>{items.map(item=><Link key={item.href} href={item.href} aria-label={item.label} aria-current={(item.href==="/admin"?path==="/admin"||path.startsWith("/admin/tenants/"):path.startsWith(item.href))?"page":undefined}>{mobile?(item.label==="Readiness"?"Check":item.label==="Webhooks"?"Hooks":item.label==="Tenants"?"Orgs":item.label==="Policies"?"Rules":item.label):item.label}</Link>)}</nav>;
}
