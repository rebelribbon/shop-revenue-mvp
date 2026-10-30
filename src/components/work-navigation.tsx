import Link from "next/link";

export function WorkNavigation({ current }: { current: "jobs" | "estimates" | "invoices" }) {
  return <nav className="section-tabs" aria-label="Work stages">
    {([['jobs','Jobs'],['estimates','Estimates'],['invoices','Invoices']] as const).map(([key,label]) =>
      <Link key={key} href={`/app/${key}`} aria-current={current===key?'page':undefined}>{label}</Link>)}
  </nav>;
}
