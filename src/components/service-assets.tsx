import Link from "next/link";
import { ActionForm } from "./action-form";
import { saveServiceAssetAction, archiveServiceAssetAction } from "@/server/actions/service-assets";
import type { listServiceAssets } from "@/domain/service-assets";

type Asset = Awaited<ReturnType<typeof listServiceAssets>>[number];
function AssetFields({type,properties,asset}:{type:"property"|"equipment";properties:Asset[];asset?:Asset}) {
  const fields = type === "property" ? [["addressLine1","Street address"],["addressLine2","Suite / unit"],["city","City"],["region","State / region"],["postalCode","ZIP / postal code"]] : [["manufacturer","Manufacturer"],["model","Model"],["serialNumber","Serial number"],["installedOn","Installation date"]];
  return <>
    <label> {type === "property" ? "Property name" : "Equipment name"}<input name="displayName" required maxLength={200} defaultValue={asset?.displayName} placeholder={type === "property" ? "Home, rental unit, office" : "Upstairs AC, water heater"}/></label>
    {type === "equipment" && <label>Property<select name="parentAssetId" defaultValue={asset?.parentAssetId??""}><option value="">No property selected</option>{properties.map(p=><option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label>}
    {fields.map(([name,label])=><label key={name}>{label}<input name={name} type={name === "installedOn"?"date":"text"} required={name === "addressLine1"} maxLength={200} defaultValue={asset?.details[name]??""}/></label>)}
    <label>Service / access notes<textarea name="notes" rows={3} maxLength={5000} defaultValue={asset?.details.notes??""}/></label>
  </>;
}
export function ServiceAssets({customerId,assets,readOnly=false}:{customerId:string;assets:Asset[];readOnly?:boolean}) {
  const properties=assets.filter(a=>a.type === "property");
  return <section><h2>Properties &amp; equipment</h2>
    {!assets.length&&<p className="muted">Add a service address or equipment item to start quoting work.</p>}
    {assets.map(a=><article className="card" key={a.id}><h3>{a.displayName}</h3><p className="muted">{a.type === "property" ? [a.details.addressLine1,a.details.addressLine2,a.details.city,a.details.region,a.details.postalCode].filter(Boolean).join(", ") : [a.details.manufacturer,a.details.model,a.details.serialNumber,properties.find(p=>p.id===a.parentAssetId)?.displayName].filter(Boolean).join(" · ")}</p><p>{a.details.notes}</p>
      <Link className="btn secondary" href={`/app/jobs?${new URLSearchParams({customerId,serviceAssetId:a.id})}`}>Create job / estimate</Link>
      {!readOnly&&<><details><summary>Edit {a.type}</summary><ActionForm action={saveServiceAssetAction} hidden={{customerId,assetId:a.id,type:a.type}} submitLabel="Save changes"><AssetFields type={a.type as "property"|"equipment"} properties={properties} asset={a}/></ActionForm></details><ActionForm action={archiveServiceAssetAction} hidden={{customerId,assetId:a.id}} submitLabel="Archive" variant="danger" confirm="Archive this item? Archiving a property also archives its equipment. Existing estimates and history remain."/></>}
    </article>)}
    {!readOnly&&<div className="form-grid">{(["property","equipment"] as const).map(type=><div className="card" id={`new-${type}`} key={type}><h3>Add {type}</h3><ActionForm action={saveServiceAssetAction} hidden={{customerId,type}} submitLabel={`Add ${type}`}><AssetFields type={type} properties={properties}/></ActionForm></div>)}</div>}
  </section>;
}
