"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
export function RefreshJobStatus() {
 const router=useRouter();const [pending,start]=useTransition();
 return <button className="btn primary" data-page-primary disabled={pending} onClick={()=>start(()=>router.refresh())}>{pending?"Checking…":"Refresh customer decision"}</button>;
}
