/* eslint-disable @next/next/no-location-assign-relative-destination */

/* This adapter is the only mutable surface of the approved HTML shell.
   The live app never uses the prototype's browser storage or simulated actions. */
const liveWrite = async (operation, payload) => {
  const r = await fetch("/automotive/actions", {
    method: "POST",
    credentials: "same-origin",
    headers: {"content-type": "application/json", "accept": "application/json"},
    body: JSON.stringify({operation, payload, clientRequestId: crypto.randomUUID()})
  });
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw new Error("Your session may have expired. Please sign in again.");
  const value = await r.json();
  if (!value.ok) throw new Error(value.error?.message || "Unable to save this change.");
  return value.data;
};
const lastName = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return [parts[0] || "", parts.slice(1).join(" ")];
};
const putCustomer = async (form, id) => {
  const f = formData(form);
  const names = lastName(f.name);
  if (!names[0]) return alert("Enter the customer's name.");
  const payload = {firstName:names[0], lastName:names[1], phone:String(f.phone || ""), email:String(f.email || ""), addressLine1:String(f.address || ""), notes:String(f.notes || ""), assignedUserId:String(f.advisor || data.actor)};
  try {
    if (id) {payload.customerId=id; await liveWrite("customer.update", payload);}
    else {
      const made=await liveWrite("customer.create",payload);
      window.location.assign("/automotive?customer=" + encodeURIComponent(made.id));
      return;
    }
    window.location.reload();
  } catch(e) { alert(e.message || "Customer not saved."); }
};
saveCustomer = putCustomer;
saveVehicle = async (form) => {
  const f = formData(form);
  try {
    const made = await liveWrite("vehicle.create", {
      customerId:String(f.customer || ""), year:f.year || null,
      make:String(f.make || ""), model:String(f.model || ""),
      mileage:f.mileage || null, vin:String(f.vin || ""), plate:String(f.plate || "")
    });
    window.location.assign("/automotive?vehicle=" + encodeURIComponent(made.id));
  } catch(e) {alert(e.message || "Vehicle not saved.");}
};
createRo = async (form) => {
  const f=formData(form);
  if (!f.customer || !f.vehicle) return alert("Choose a customer and vehicle.");
  try {
    const made=await liveWrite("ro.checkin", {
      customerId:String(f.customer), vehicleId:String(f.vehicle),
      mileageIn:f.mileage || null, concerns:String(f.concern || ""),
      technicianUserId:String(f.tech || ""), sourceAppointmentId:String(f.appointment || "")
    });
    if (data.manager && f.advisor && String(f.advisor)!==data.actor) {
      const result = await liveWrite("ro.assign-advisor", {jobId:made.id,userId:String(f.advisor)});
      if (!result) throw new Error("Could not assign the selected advisor.");
    }
    window.location.assign("/automotive?ro=" + encodeURIComponent(made.id));
  }catch(e){alert(e.message || "Check-in failed. No RO was created in this browser.");}
};
saveAppointment = async(form,id) => {
  const f=formData(form),when=String(f.date||"")+"T"+String(f.time||"09:00");
  if(!String(f.date||"") || !String(f.time||""))return alert("Choose a date and time.");
  try{
    if(id){
      const ap=(data.appointments||[]).find(x=>x.id===id);
      if(!ap)throw new Error("Appointment not found. Reload.");
      if(String(f.customer||"")!==ap.customer || String(f.vehicle||"")!==ap.vehicle ||
        String(f.purpose||"")!==String(ap.purpose||""))
        throw new Error("To change the customer, vehicle or reason, cancel this appointment and schedule a new one.");
      if(String(f.date)!==ap.date || String(f.time)!==ap.time)
        await liveWrite("appointment.reschedule",{appointmentId:id,startsAt:when});
      const requested=String(f.status||"Scheduled");
      const next=requested==="Canceled"?"cancelled":requested==="Scheduled"||requested==="Confirmed"?"scheduled":null;
      if(requested==="Arrived" && ap.status!=="Arrived")
        throw new Error("Arrival is recorded when you check the vehicle in and create its repair order.");
      if(!next && requested!=="Arrived")throw new Error("Unsupported appointment status.");
      if(next && !(next==="scheduled" && ["Scheduled","Confirmed","scheduled"].includes(ap.status)))
        await liveWrite("appointment.status",{appointmentId:id,status:next});
    }else{
      await liveWrite("appointment.create",{
        customerId:String(f.customer||""),vehicleId:String(f.vehicle||""),
        startsAt:when,reason:String(f.purpose||""),notes:""
      });
    }
    window.location.assign("/automotive?view=appointments");
  }catch(e){alert(e.message||"Appointment was not saved.");}
};
assignCustomer = async(form,id)=>{
  const f=formData(form);
  try{await liveWrite("customer.assign",{customerId:id,userId:String(f.advisor || "")});window.location.reload();}
  catch(e){alert(e.message || "Reassignment failed.");}
};
assignRo=async(form,id)=>{
  const f=formData(form);
  try{
    const r=roBy(id);
    if(String(f.advisor||"")!==String(r.advisor||"")) await liveWrite("ro.assign-advisor",{jobId:id,userId:String(f.advisor || "")});
    if(String(f.tech||"")!==String(r.tech||"")) await liveWrite("ro.assign-tech",{jobId:id,userId:String(f.tech || "")});
    window.location.reload();
  }catch(e){alert(e.message || "Assignment failed.");}
};
const originalOpenModal=openModal;
openModal=function(type,extra){
  if(type==="role") return alert("Employee access is enforced by sign-in. Use the employee's own account to see their workspace.");
  if(type==="staff"||type==="editStaff") return originalOpenModal(type,extra);
  if(type==="collect"||type==="receipt") return originalOpenModal(type,extra);
  return originalOpenModal(type,extra);
};
// Each checkpoint is saved under its exact approved key; never recode it
// as an unrelated legacy vehicle-inspection component.
const persistedInspectionAssessment=(r)=>({
  diagnosis:String(r.inspectionAssessment?.diagnosis || ""),
  bay:String(r.inspectionAssessment?.bay || ""),
  vehiclePickedUp:!!r.inspectionAssessment?.vehiclePickedUp
});
const liveInspectionSave=async(r,items,assessment,submit=false)=>{
  const result=await liveWrite("inspection.save",{
    jobId:r.id,items:JSON.stringify(items),assessment,submit
  });
  if(!result)throw new Error("The inspection was not saved.");
  r.inspectionItems=items;
  r.inspectionAssessment=assessment;
  return result;
};
submitInspection=function(form,id){
  const r=roBy(id);
  if(!r)return;
  if(role()==="owner"){
    ui.technicianMode=true;ui.tab="diagnosis";render();
  }else alert("The assigned technician must complete the 40-point inspection before pricing.");
};
submitInspectionComplete=async function(id){
  const r=roBy(id);
  if(!r || r.stage!=="inspection")return;
  const items=r.inspectionItems || [], assessment=persistedInspectionAssessment(r);
  if(items.length!==40 || items.some(i=>i.status==="unchecked"))
    return alert("Record all 40 checkpoint results before submitting.");
  if(!assessment.bay || !assessment.vehiclePickedUp || !assessment.diagnosis)
    return alert("Save the diagnosis, bay and vehicle pickup confirmation first.");
  if(items.some(i=>(i.status==="fix"||i.status==="watch")&&(!i.note.trim()||!i.recommendedWork.trim())))
    return alert("Enter a finding and recommended work for each flagged checkpoint.");
  try{
    await liveInspectionSave(r,items,assessment,true);
    window.location.assign("/automotive?ro="+encodeURIComponent(id));
  }catch(e){alert(e.message||"Could not submit inspection.");}
};
const estimatesBeingSent=new Set();
sendEstimate=async function(id){
  const r=roBy(id);
  if(!r || techView() || estimatesBeingSent.has(id))return;
  if(!["estimate","approval"].includes(r.stage))
    return alert("Only a priced draft or unsigned estimate can be sent.");
  const c=data.customers.find(x=>x.id===r.customer);
  if(!c?.email)return alert("Add a valid email to this customer's profile before sending the estimate.");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))
    return alert("Correct the customer's email address before sending.");
  if(data.authorizationPolicyReady!==true){window.location.assign("/automotive?view=authorization&returnRo="+encodeURIComponent(id));return;}
  estimatesBeingSent.add(id);
  try{
    let estimateId=r.estimateId;
    let path="";
    if(r.stage==="estimate"){
      if(!r.lines?.length)return alert("Price at least one recommendation before sending.");
      const result=await liveWrite("estimate.freeze",{
        jobId:id,expectedJobVersion:r.version,
        taxBps:Math.round(Number(data.settings?.tax||0)*100),
        supplementReason:"",
        terms:"Each recommendation requires the customer's individual approval. Work begins only after signed authorization."
      });
      estimateId=result.id;
      path=result.path || "";
    }
    if(!estimateId)throw new Error("The current estimate document could not be found.");
    if(!path){
      const prepared=await liveWrite("document.prepare",{id:estimateId,kind:"estimate"});
      path=prepared.path || "";
    }
    if(!path)throw new Error("Unable to prepare the secure customer link.");
    try{
      await liveWrite("document.email",{id:estimateId,kind:"estimate",email:c.email});
    }catch(err){
      window.prompt("Estimate finalized but email was not accepted. Copy the secure link and send it manually: " +
        (err.message || ""),new URL(path,window.location.origin).href);
      window.location.assign("/automotive?ro="+encodeURIComponent(id)+"&tab=proposal");
      return;
    }
    try{
      await liveWrite("document.shared",{jobId:id,documentId:estimateId,kind:"estimate"});
    }catch(err){
      alert("The email was submitted, but the sharing-history update failed. Do not resend solely because of this warning.");
    }
    window.location.assign("/automotive?ro="+encodeURIComponent(id)+"&tab=proposal");
  }catch(err){
    alert(err.message || "Could not finalize the estimate.");
  }finally{estimatesBeingSent.delete(id);}
};
// Price one customer-decision line at a time, with internal cost visually
// separated from the amounts presented to the customer.
const recommendationSourceLabels={inspection:"Inspection finding",maintenance:"Recommended maintenance",diagnosis:"Diagnosis-based repair",advisor:"Shop recommendation",prior:"Previous recommendation"};
function recommendationSourceLabel(source){return recommendationSourceLabels[source]||"Additional recommendation";}
window.prefillEstimateFromInspection=function(roId,itemKey){
  const form=document.getElementById("estimate-add-work"),r=roBy(roId);
  const finding=r?.inspectionItems?.find(item=>item.key===itemKey);
  if(!form||!finding)return;
  const source=form.querySelector('[name="workSource"]');
  const key=form.querySelector('[name="inspectionItemKey"]');
  const name=form.querySelector('[name="name"]');
  if(source)source.value="inspection";
  if(key)key.value=itemKey||"";
  if(name)name.value=finding.recommendedWork||finding.label||"";
  form.scrollIntoView({behavior:"smooth",block:"center"});
  if(name)name.focus();
};
roEstimate=function(r){
  if(!advisor())return '<div class="notice">Technicians do not have access to customer pricing.</div>';
  const editable=r.stage==="estimate";
  if(!editable)return '<div class="section-head"><h2>Estimate pricing</h2></div><p class="notice">'+
    (r.stage==="inspection"?"Finish technician inspection before pricing.":
    "This estimate is no longer editable. Additional repairs require a new customer authorization.")+'</p>'+
    (r.lines?.length?estimateSummary(r):"");
  const lines=r.lines||[];
  const requested=lines.filter(l=>!l.recommended);
  const additional=lines.filter(l=>l.recommended);
  const subtotal=lines.reduce((n,l)=>n+Number(l.parts)+Number(l.labor),0);
  const priceList=(items)=>items.length?'<div class="stack">'+items.map((line)=>{
    const source=line.recommended?(line.recommendationSource||"advisor"):"requested";
    const badge=line.recommended?'<span class="estimate-source-badge source-'+esc(source)+'">'+esc(recommendationSourceLabel(source))+'</span>':'<span class="estimate-source-badge source-requested">Customer requested</span>';
    const move=line.originLocked?'<span class="secondarytext">Source locked to documented recommendation</span>':
      '<label class="estimate-source-select">Reason<select onchange="reclassifyRepair(\''+r.id+'\',\''+line.id+'\',this.value)">'+
      '<option value="requested" '+(!line.recommended?"selected":"")+'>Customer requested</option>'+
      '<option value="inspection" '+(source==="inspection"?"selected":"")+'>Inspection finding</option>'+
      '<option value="maintenance" '+(source==="maintenance"?"selected":"")+'>Maintenance due</option>'+
      '<option value="diagnosis" '+(source==="diagnosis"?"selected":"")+'>Diagnosis</option>'+
      '<option value="advisor" '+(source==="advisor"?"selected":"")+'>Advisor/shop recommendation</option>'+
      '</select></label>';
    return '<article class="estimate-work-card"><div class="estimate-work-heading"><div class="estimate-line-title"><b>'+esc(line.name)+'</b>'+badge+'</div>'+
    '<strong class="estimate-work-total">'+money(Number(line.parts)+Number(line.labor))+'</strong></div>'+
    '<dl class="estimate-work-prices"><div><dt>Parts</dt><dd>'+money(line.parts)+'</dd></div><div><dt>Labor</dt><dd>'+money(line.labor)+'</dd></div></dl>'+
    '<p class="estimate-work-cost">Internal shop cost <strong>'+money(line.cost)+'</strong></p>'+
    '<div class="estimate-work-actions">'+move+'<button class="btn danger" onclick="removeLine(\''+r.id+'\',\''+line.id+'\')">Remove</button></div></article>';
  }).join("")+'</div>':'<p class="sub">No work priced in this section.</p>';
  const checks=r.inspectionItems||[];
  const inspection=checks.filter(i=>i.status==="watch"||i.status==="fix");
  const passed=checks.filter(i=>i.status==="good").length;
  const notApplicable=checks.filter(i=>i.status==="na").length;
  const failed=checks.filter(i=>i.status==="fix").length;
  const caution=checks.filter(i=>i.status==="watch").length;
  let diagnosis=r.inspectionAssessment?.diagnosis||"";
  try{
    const parsed=JSON.parse(diagnosis);
    if(parsed && typeof parsed==="object")
      diagnosis=["confirmed","symptoms","codes","tests","cause","recommendation"]
        .filter(k=>parsed[k])
        .map(k=>k[0].toUpperCase()+k.slice(1)+": "+parsed[k]).join("\n");
  }catch{}
  const diagnosisHtml=diagnosis?
    '<p class="estimate-reference-diagnosis">'+esc(diagnosis)+'</p>':
    '<p class="sub">No technician diagnosis recorded.</p>';
  const findings=inspection.length?'<div class="estimate-reference-findings">'+inspection.map(i=>
    '<article class="estimate-reference-finding"><div class="estimate-reference-finding-title"><b>'+esc(i.label)+'</b>'+
    '<span class="estimate-reference-status '+(i.status==="fix"?"is-fail":"is-caution")+'">'+
    (i.status==="fix"?"Needs repair":"Monitor")+'</span></div>'+
    (i.note?'<p>'+esc(i.note)+'</p>':"")+
    (i.recommendedWork?'<p><strong>Technician recommends:</strong> '+esc(i.recommendedWork)+'</p>'+
      '<button class="btn small" type="button" onclick="prefillEstimateFromInspection(\''+r.id+'\',\''+esc(i.key)+'\')">+ Add to estimate</button>':"")+
    '</article>').join("")+'</div>':
    '<p class="sub">No Caution or Fail findings were recorded.</p>';
  const media=(r.media||[]).filter(m=>m.kind==="photo"||m.kind==="video");
  const evidence=media.length?'<div class="estimate-reference-media">'+media.map(m=>{
    const source=esc(m.fileUrl||m.dataUrl||"");
    const caption=esc(m.caption||m.name||"Inspection evidence");
    if(m.kind==="video")
      return '<figure><video controls preload="none" src="'+source+'" aria-label="'+caption+'"></video><figcaption>'+caption+'</figcaption></figure>';
    return '<figure><a target="_blank" rel="noopener noreferrer" href="'+source+'" title="View full inspection photo">'+
      '<img loading="lazy" src="'+source+'" alt="'+caption+'"></a><figcaption>'+caption+'</figcaption></figure>';
  }).join("")+'</div>':
  '<p class="sub">No photos or videos attached to this repair order.</p>';
  const otherChecks=checks.length?
    '<details class="estimate-reference-checks"><summary>All '+checks.length+' recorded inspection points</summary><ul>'+
    checks.map(i=>'<li><span>'+esc(i.label)+'</span><b>'+
      (i.status==="good"?"Passed":i.status==="fix"?"Needs repair":i.status==="watch"?"Monitor":
      i.status==="na"?"N/A":"Not checked")+'</b></li>').join("")+
    '</ul></details>':"";
  const reference='<div class="estimate-reference-content">'+
    '<section><h3>Original customer concern</h3><p>'+esc(r.concern||"Not recorded")+'</p></section>'+
    '<section><h3>Technician diagnosis</h3>'+diagnosisHtml+'</section>'+
    '<section><h3>40-point inspection</h3>'+
    '<div class="estimate-reference-totals"><span>'+passed+' passed</span><span>'+caution+' caution</span>'+
    '<span>'+failed+' need repair</span><span>'+notApplicable+' N/A</span></div>'+findings+otherChecks+'</section>'+
    '<section><h3>Inspection photos &amp; video</h3>'+evidence+'</section></div>';
  const referenceDesktop='<aside class="card card-pad estimate-reference-desktop" aria-label="Inspection reference">'+
    '<div class="estimate-reference-heading"><h2>Inspection reference</h2><p class="sub">Read the technician findings while pricing work.</p></div>'+
    reference+'</aside>';
  const referenceMobile='<details class="card estimate-reference-mobile"><summary>View diagnosis, inspection &amp; photos</summary>'+
    reference+'</details>';
  const pricing='<div class="estimate-builder-column">'+
    '<section class="card card-pad"><h3>1 · Work the customer requested</h3>'+
    '<p class="sub">'+esc(r.concern||"Customer concern not recorded")+'</p>'+priceList(requested)+'</section>'+
    '<section class="card card-pad"><h3>2 · Additional recommended work</h3>'+
    '<p class="sub">Use the inspection reference to price additional repairs or maintenance. The customer will approve or decline each item.</p>'+
    priceList(additional)+'</section>'+
    '<section class="card card-pad"><h3>Add work to this proposal</h3>'+
    '<form id="estimate-add-work" class="formgrid" style="margin-top:13px" onsubmit="event.preventDefault();addLine(this,\''+r.id+'\')">'+
    '<input type="hidden" name="inspectionItemKey" value="">'+
    '<label class="span">Why is this work included?<select name="workSource" required onchange="if(this.value!==\'inspection\')this.form.elements.inspectionItemKey.value=\'\'">'+
    '<option value="advisor">Advisor/shop recommendation</option>'+
    '<option value="maintenance">Maintenance due / service interval</option>'+
    '<option value="diagnosis">Diagnosis of customer concern</option>'+
    '<option value="requested">Customer requested this service</option>'+
    '<option value="inspection" hidden>Inspection finding</option></select></label>'+
    '<label class="span">Repair or service name<input name="name" maxlength="200" placeholder="Example: Replace front brake pads and rotors" required></label>'+
    '<label>Parts selling price ($)<input name="parts" inputmode="decimal" type="number" min="0" step="0.01" required placeholder="0.00"></label>'+
    '<label>Labor selling price ($)<input name="labor" inputmode="decimal" type="number" min="0" step="0.01" required placeholder="0.00"></label>'+
    '<div class="span"><p class="secondarytext"><b>Internal only — never shown to the customer</b></p>'+
    '<label>Shop parts + labor cost ($)<input name="cost" inputmode="decimal" type="number" min="0" step="0.01" required placeholder="0.00"></label></div>'+
    '<div class="span"><button class="btn" type="submit">+ Save repair to estimate</button></div>'+
    '</form></section>'+
    (lines.length?'<div class="action-panel"><div class="row"><b>Estimated maximum (before tax)</b><strong>'+money(subtotal)+'</strong></div>'+
    '<p class="sub">Final authorized amount is calculated from the work the customer approves.</p>'+
    '<button class="btn primary full" onclick="goTab(\'proposal\')">Review customer packet →</button></div>':"")+
    '</div>';
  return '<div class="section-head"><div><h2>Build the customer proposal</h2>'+
    '<p class="sub">Use the inspection as a reference while you add requested work and recommendations.</p></div>'+
    pill(lines.length+' priced repair(s)')+'</div>'+
    referenceMobile+
    '<div class="estimate-builder-layout">'+referenceDesktop+pricing+'</div>';
};
// Read-only representation of the customer proposal. The secure customer
// portal handles choices and signatures; the shop preview never authorizes work.
function customerPacketPreview(r){
  const groups=new Map();
  for(const line of r.lines||[]){
    const type=line.recommended?"recommended":"requested";
    const id=type+":"+line.name;
    const previous=groups.get(id)||{name:line.name,recommended:!!line.recommended,recommendationSource:line.recommendationSource||null,parts:0,labor:0};
    previous.parts+=Number(line.parts||0);
    previous.labor+=Number(line.labor||0);
    groups.set(id,previous);
  }
  const all=[...groups.values()],requested=all.filter(l=>!l.recommended);
  const recommended=all.filter(l=>l.recommended);
  const total=all.reduce((sum,l)=>sum+l.parts+l.labor,0);
  const inspection=r.inspectionItems||[];
  const findings=inspection.filter(i=>i.status==="fix"||i.status==="watch");
  const good=inspection.filter(i=>i.status==="good").length;
  const visible=(r.media||[]).filter(m=>m.public===true);
  const renderWork=(items,extra)=>items.length?items.map((l)=>
    '<div class="docrow"><div><b>'+esc(l.name)+'</b>'+
    (extra?'<p class="secondarytext"><strong>'+esc(recommendationSourceLabel(l.recommendationSource))+'</strong></p>':'')+
    '<p class="secondarytext">Parts '+money(l.parts)+' · Labor '+money(l.labor)+'</p>'+
    (extra?'<p class="secondarytext">The customer chooses Approve or Decline for this repair.</p>':'')+
    '</div><b>'+money(l.parts+l.labor)+'</b></div>').join(""):
    '<p class="sub">No priced services in this section.</p>';
  const renderFindings=findings.length?'<ul class="estimate-findings">'+findings.map(i=>
    '<li><b>'+esc(i.label)+'</b> · <span class="pill">'+
    (i.status==="fix"?"Needs attention":"Monitor")+'</span>'+
    (i.note?'<p>'+esc(i.note)+'</p>':"")+
    (i.recommendedWork?'<p class="sub">Technician recommends: '+esc(i.recommendedWork)+'</p>':"")+
    '</li>').join("")+'</ul>':
    '<p class="sub">No Caution or Fail inspection findings recorded.</p>';
  const renderMedia=visible.length?
    '<div class="stack">'+visible.map(m=>
    '<div class="item"><span aria-hidden="true">'+(m.kind==="video"?"🎥":"📷")+'</span> '+
    '<a href="'+esc(m.fileUrl)+'" target="_blank" rel="noopener noreferrer">'+
    esc(m.caption||m.name||"Customer-visible evidence")+'</a></div>').join("")+'</div>':
    '<p class="sub">No inspection media selected for customer sharing.</p>';
  const review='<div class="preview"><div class="dochead"><div>'+
    '<div class="eyebrow">'+esc(data.business)+'</div><h2>VEHICLE INSPECTION & WORK AUTHORIZATION</h2></div>'+
    '<div>'+esc(r.num)+'</div></div>'+
    '<p class="sub">Vehicle: '+esc(car(vehicle(r.vehicle)))+'</p>'+
    '<section style="margin-top:20px"><h3>1. What you brought the vehicle in for</h3>'+
    '<p>'+esc(r.concern||"Customer concern not recorded")+'</p>'+renderWork(requested,false)+'</section>'+
    '<section style="margin-top:22px"><h3>2. What our technician found</h3>'+
    '<p class="sub">'+good+' passed · '+findings.length+' need attention or monitoring</p>'+
    (r.inspectionAssessment?.diagnosis?'<p>'+esc(r.inspectionAssessment.diagnosis)+'</p>':"")+
    renderFindings+
    (inspection.length?'<details><summary>View all '+inspection.length+' recorded inspection results</summary><ul>'+
      inspection.map(i=>'<li>'+esc(i.label)+' — '+
        (i.status==="good"?"Passed":i.status==="na"?"Not applicable":i.status==="watch"?"Monitor":"Needs attention")+
        '</li>').join("")+'</ul></details>':"")+
    renderMedia+'</section>'+
    '<section style="margin-top:22px"><h3>3. Additional recommended work</h3>'+
    '<p class="sub">These are separate from the work originally requested. The customer can approve or decline each one.</p>'+
    renderWork(recommended,true)+'</section>'+
    '<section style="margin-top:22px"><h3>4. Your authorization</h3>'+
    '<p class="sub">Customer reviews and explicitly approves or declines all priced work. Nothing is preselected.</p>'+
    '<div class="metricrow"><span>All proposed work before tax</span><strong>'+money(total)+'</strong></div>'+
    '<p class="notice">The final total includes only approved items plus applicable tax. This amount updates as the customer chooses each repair.</p>'+
    '<p class="secondarytext">The customer then reviews authorization terms and signs. This is not an invoice or a payment request.</p></section>'+
    '</div>';
  return review;
}
// Keep the advisor in one RO screen from pricing through customer review and send.
// The inline preview reflects the current draft; the immutable customer document
// is created when the advisor finalizes it. Legal approval is never simulated.
window.saveProposalRecipient=async function(form,roId){
  const r=roBy(roId),recipient=r&&data.customers.find(x=>x.id===r.customer);
  if(!recipient||techView())return;
  const email=String(form.elements.email.value||"").trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return alert("Enter a valid customer email.");
  try{
    await liveWrite("customer.email",{customerId:recipient.id,email});
    window.location.assign("/automotive?ro="+encodeURIComponent(roId)+"&tab=proposal");
  }catch(error){alert(error.message||"Could not save the customer email.");}
};
window.editProposalRecipient=function(id){
  const r=roBy(id);
  if(!r || techView())return;
  ui.modal={type:"proposalRecipient",id:r.customer,roId:r.id};
  render();
};
roProposal=function(r){
  if(techView())return '<div class="notice">Customer pricing and documents are restricted to the front office.</div>';
  if(!r.lines?.length)return '<div class="empty"><h3>Start with the recommendations</h3><p>Add parts and labor prices before reviewing the customer estimate.</p><button class="btn primary" onclick="goTab(\'estimate\')">Build estimate</button></div>';
  const recipient=data.customers.find(x=>x.id===r.customer);
  const email=String(recipient?.email||"").trim();
  const emailReady=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const legalReady=data.authorizationPolicyReady===true;
  const sent=!!r.estimateSent;
  const awaiting=r.stage==="approval"&&!r.authorized;
  const locked=!["estimate","approval"].includes(r.stage);
  const total=r.lines.reduce((n,l)=>n+Number(l.parts)+Number(l.labor),0);
  const prepStatus=sent?"Sent to customer":r.stage==="approval"?"Finalized · ready to email":"Draft · not yet sent";
  const header='<div class="section-head"><div><h2>Customer estimate</h2><p class="sub">Price → Review → Send. All actions stay inside this repair order.</p></div>'+pill(r.authorized?"Signed":prepStatus,r.authorized?"green":sent?"amber":"blue")+'</div>';
  const steps='<div class="steps-mini"><span class="done">✓ 1. Price</span><span class="'+(sent?"done":"active")+'">2. Review</span><span class="'+(sent?"done":"")+'">3. Send</span><span class="'+(r.authorized?"done":"")+'">'+(r.authorized?"✓":"4.")+' Customer decision</span></div>';
  const policyNotice=!legalReady?
    '<div class="notice warn" role="alert"><b>Set up customer authorization terms</b><p>The shop owner needs to review and enable the terms customers will sign. This is a one-time shop setting.</p>'+(data.authorizationSetup?.canAct?'<a class="btn" href="/automotive?view=authorization&amp;returnRo='+encodeURIComponent(r.id)+'">Set up authorization terms</a>':'<p>Ask the shop owner to open Settings → Customer authorization.</p>')+'</div>':"";
  const emailNotice=!emailReady?
    '<div class="notice warn" role="alert">A valid customer email is required before sending. Use Edit recipient to add or correct it.</div>':"";
  const review='<div class="card card-pad"><div class="section-head"><h3>1 · Review the estimate</h3><button class="btn small" onclick="goTab(\'estimate\')">Edit pricing</button></div>'+
    '<p class="sub">'+r.lines.length+' priced recommendation(s) · '+money(total)+' subtotal before tax</p>'+
    customerPacketPreview(r)+
    (legalReady?'<details class="card card-pad" style="margin-top:12px"><summary><b>View customer authorization terms</b></summary><p class="secondarytext" style="white-space:pre-wrap;margin-top:12px">'+esc(data.authorizationPolicyBody||"")+'</p></details>':"")+
    '<p class="secondarytext" style="margin-top:12px">The estimate and authorization terms are saved together when you send. The customer then chooses each repair and signs.</p>'+
    '<button class="btn full" style="margin-top:12px" onclick="openCustomerPreview(\''+r.id+'\')">Preview customer-facing estimate</button></div>';
  const recipientPanel='<div class="card card-pad"><div class="section-head"><h3>2 · Confirm recipient</h3><button class="btn small" onclick="editProposalRecipient(\''+r.id+'\')">Edit recipient</button></div>'+
    '<div class="metricrow"><span>Name</span><strong>'+esc(recipient?.name||"Missing")+'</strong></div>'+
    '<div class="metricrow"><span>Email</span><strong style="overflow-wrap:anywhere">'+esc(email||"Missing")+'</strong></div>'+
    '<p class="sub">The secure approval link is sent by email. The customer signs on their own device; staff cannot authorize work on their behalf.</p>'+
    emailNotice+'</div>';
  const sentPanel=sent?
    '<div class="notice good"><strong>Estimate email submitted</strong><p>Customer decision: '+(r.authorized?"Signed and recorded":"Awaiting approval/decline and signature")+'</p>'+(r.estimateOpened?'<p>Customer opened: '+esc(r.estimateOpened)+'</p>':"")+'</div>':"";
  const canSend=!sent&&!r.authorized&&!locked&&legalReady&&emailReady;
  const preSent=r.stage==="approval"&&!sent&&!r.authorized?
    '<p class="notice">Estimate finalized. Sharing has not been recorded.</p>':"";
  const opened=r.estimateOpened?
    '<p class="notice" role="status">Customer opened the proposal · '+esc(r.estimateOpened)+'</p>':"";
  const sendPanel='<div class="card card-pad"><h3>3 · Send and track</h3>'+
    '<p class="sub">Sending finalizes the estimate version, prepares a secure customer link, and emails the recipient. It does not authorize any repairs.</p>'+
    policyNotice+preSent+sentPanel+opened+
    (canSend?'<button class="btn primary full" onclick="sendEstimate(\''+r.id+'\')">'+(r.stage==="approval"?"Send finalized estimate":"Finalize and email estimate →")+'</button>':
      !sent&&!r.authorized&&!locked?'<button class="btn primary full" disabled title="Complete the missing setup and recipient details">Finalize and email estimate</button>':"")+
    '<p class="secondarytext">After sending: this RO records the email submission, customer view, signed decisions and work approval.</p></div>';
  return header+steps+'<div class="stack">'+review+recipientPanel+sendPanel+'</div>';
};
submitApproval=function(id){
  const r=roBy(id);
  if(!r || techView())return;
  ui.page="jobs";ui.selectedRo=id;ui.tab="documents";render();
  if(!r.authorized)
    alert("The customer must approve or decline every line and sign the secure estimate link. Shop staff cannot authorize work for them.");
};
// Completion is verified and saved below using repair.finish.
const invoicesBeingSent=new Set();
sendInvoice=async function(id){
  const r=roBy(id);
  if(!r || invoicesBeingSent.has(id) || techView())return;
  if(!["invoice","payment"].includes(r.stage))
    return alert("Complete authorized repairs before invoicing.");
  const c=data.customers.find(x=>x.id===r.customer);
  if(!c?.email)return alert("Add a customer email address before sending the invoice.");
  invoicesBeingSent.add(id);
  try{
    let invoiceId=r.invoiceId;
    if(!invoiceId){
      if(!r.estimateId)throw new Error("The customer's signed estimate is missing.");
      const issue=await liveWrite("invoice.issue",{
        versionId:r.estimateId,dueOn:"",
        terms:"Payment is due upon completion of authorized vehicle repairs."
      });
      invoiceId=issue.id;
    }
    if(!invoiceId)throw new Error("Invoice could not be issued.");
    let path="";
    try{
      const prepared=await liveWrite("document.prepare",{id:invoiceId,kind:"invoice"});
      path=prepared.path||"";
    }catch(e){throw new Error("The invoice exists, but its payment link is unavailable: "+e.message);}
    try{
      await liveWrite("document.email",{id:invoiceId,kind:"invoice",email:c.email});
    }catch(e){
      window.prompt("Invoice issued but the email was not accepted. Copy the secure payment link: "+
        e.message,new URL(path,window.location.origin).href);
      window.location.assign("/automotive?ro="+encodeURIComponent(id)+"&tab=invoice");
      return;
    }
    try{
      await liveWrite("document.shared",{jobId:id,documentId:invoiceId,kind:"invoice"});
    }catch(e){alert("The email was submitted, but sharing history did not update. Do not resend solely for this warning.");}
    window.location.assign("/automotive?ro="+encodeURIComponent(id)+"&tab=payment");
  }catch(e){alert(e.message||"Could not issue or send the invoice.");}
  finally{invoicesBeingSent.delete(id);}
};
recordPayment=async function(form,id){
  const r=roBy(id);
  if(!r?.invoiceId || !r.invoiceSent || r.invoiceBalanceCents<=0)return;
  const f=formData(form);
  if(!f.confirmed)return alert("Confirm receipt of actual customer funds first.");
  const method=String(f.method||"");
  if(!["cash","check","external_card","bank_transfer"].includes(method))
    return alert("Choose an actual payment method.");
  const reference=String(f.ref||"").trim();
  if(method==="external_card" && !reference)
    return alert("Enter the external processor's transaction reference.");
  try{
    const amountCents=centsFromForm(f.amount);
    if(amountCents<=0 || amountCents>r.invoiceBalanceCents)
      throw new Error("Amount must be positive and no more than the unpaid balance.");
    await liveWrite("payment.record",{
      invoiceId:r.invoiceId,amountCents,method,reference
    });
    window.location.assign("/automotive?ro="+encodeURIComponent(id)+"&tab=payment");
  }catch(e){alert(e.message||"No payment was recorded.");}
};
closeRo=async function(id){
  const r=roBy(id);
  if(!r || !r.paid || techView())return;
  if(!confirm("Confirm the customer has received the vehicle and all keys?"))return;
  try{
    await liveWrite("ro.release",{jobId:id});
    window.location.assign("/automotive?ro="+encodeURIComponent(id));
  }catch(e){alert(e.message||"The repair order was not closed.");}
};
const centsFromForm = (amount) => {
  const text = String(amount ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(text))
    throw new Error("Enter a nonnegative dollar amount with at most two decimals.");
  return Math.round(Number(text) * 100);
};
const showPricedRo = (id) =>
  window.location.assign("/automotive?ro=" + encodeURIComponent(id) + "&tab=estimate");
addLine = async function(form,id) {
  const r = roBy(id);
  if (!r || r.stage !== "estimate") return alert("This RO is not ready for pricing.");
  const f = formData(form);
  try {
    const partsCents = centsFromForm(f.parts);
    const laborCents = centsFromForm(f.labor);
    const costCents = centsFromForm(f.cost);
    if (!String(f.name || "").trim() || partsCents + laborCents <= 0)
      throw new Error("Enter the recommendation and a positive selling price.");
    await liveWrite("ro.pricing.add", {
      jobId: id, expectedVersion: r.version, description: String(f.name).trim(),
      partsCents, laborCents, costCents, workSource: String(f.workSource || "advisor"),
      inspectionItemKey: String(f.inspectionItemKey || "") || undefined
    });
    showPricedRo(id);
  } catch(e) { alert(e.message || "Recommendation was not saved."); }
};
window.reclassifyRepair=async function(roId,lineId,workSource){
  const r=roBy(roId),line=r?.lines?.find(item=>item.id===lineId);
  if(!r||r.stage!=="estimate"||!line)return;
  try{
    await liveWrite("ro.pricing.classify",{
      jobId:roId,expectedVersion:r.version,description:line.name,workSource
    });
    showPricedRo(roId);
  }catch(error){alert(error.message||"Could not change the repair category.");}
};
removeLine = async function(roId,lineId) {
  const r = roBy(roId);
  const line = r?.lines.find(l => l.id === lineId);
  if (!r || r.stage !== "estimate" || !line || !lineId.startsWith("draft-"))
    return alert("This recommendation can no longer be removed from the draft.");
  try {
    await liveWrite("ro.pricing.remove", {
      jobId:roId, expectedVersion:r.version, description:line.name
    });
    showPricedRo(roId);
  } catch(e) { alert(e.message || "Recommendation was not removed."); }
};
setApproval = function(){alert("Use the actual secure customer approval link sent from the RO.");};
// Keep the approved contact-log modal but use outcomes the server recognizes.
contactResultOptions=function(channel){
  const options={
    Call:[["reached","Connected"],["left_message","Left voicemail"],["no_answer","No answer"],["received","Customer returned call"]],
    Text:[["sent","Text sent"],["received","Customer replied"]],
    Email:[["sent","Email sent"],["received","Customer replied"]],
    "In person":[["completed","Spoke with customer"],["received","Customer contacted us"]]
  };
  return (options[channel]||options["In person"]).map(([value,label])=>
    '<option value="'+value+'">'+esc(label)+'</option>').join("");
};
saveContact=async function(form,id){
  const f=formData(form);
  if(!id || !data.customers.some(c=>c.id===id))
    return alert("Choose a customer before recording contact.");
  const channel=String(f.method)==="In person"?"other":String(f.method||"").toLowerCase();
  const summary=String(f.summary||"").trim();
  if(!summary)return alert("Enter what happened during this contact.");
  try{
    await liveWrite("correspondence.log",{customerId:id,channel,
      outcome:String(f.outcome||""),summary});
    window.location.assign("/automotive?customer="+encodeURIComponent(id));
  }catch(e){alert(e.message||"Contact was not saved.");}
};

resetDemo = function(){alert("Live shop records cannot be reset.");};
exportData=function(){ui.page="reports";ui.selectedRo=null;render();};
launchCustomerDemo=function(){
  const ro=(data.ros||[]).find(x=>!!x.estimateId);
  if(ro)openCustomerPreview(ro.id);
  else alert("There are no finalized customer estimates to preview yet.");
};
openCustomerPreview = function(id){
  const r=roBy(id);
  if(!r || techView())return;
  ui.modal={type:"customerPacket",id};
  render();
};
customerRoute = function(){return null;};
settingsPrototype = function(){return "";};
unifiedWalkthrough = function(){return "";};
techDemoLauncher = function(){return "";};
// Remove prototype-only badges and the fake employee role switcher.
const originalHeader = header;
header = function () {
  if (["billing","payments","authorization"].includes(ui.page)) return '<header class="topbar"><div class="crumb">' + esc(data.business) +
    '<span class="quiet"> / </span>'+({billing:"Billing",payments:"Account requirements",authorization:"Customer authorization"})[ui.page]+'</div><div class="top-actions"><a class="btn small" aria-label="Settings" href="/automotive?view=settings">' +
    icon("settings").replace('<svg ', '<svg width="20" height="20" ') + '<span>Settings</span></a></div></header>';
  return originalHeader()
    .replace("● Automotive · Offline preview", "● Automotive · Live workspace")
    .replace(/<button class="btn small" onclick="openModal\('role'\)">.*?<\/button>/,
      '<a class="btn small" style="min-height:48px;gap:8px" aria-label="Settings" title="Signed in as ' + esc(role()) + '. Open Settings" href="/automotive?view=settings">' +
      icon("settings").replace('<svg ', '<svg width="20" height="20" ') + '<span>Settings</span></a>');
};
// Upload directly from the approved technician workspace, never through
// a legacy page or a prototype data URL. The backend checks shop membership
// and current technician assignment for each upload and update.
const uploadAutomotiveMedia = async (event, roId, kind, checkId = "") => {
  const input = event.target, file = input.files?.[0], r = roBy(roId);
  if (!file || !r) return;
  input.disabled = true;
  try {
    const photo = kind !== "video";
    if (photo ? !file.type.startsWith("image/") : !file.type.startsWith("video/"))
      throw new Error("Choose the correct photo or video format.");
    const prep = await liveWrite("media.prepare", {
      customerId: r.customer, contentType: file.type, byteSize: file.size
    });
    // Uploads use a short-lived server-signed storage URL.
    const uploaded = await fetch(prep.uploadUrl, {
      method: "PUT", headers: { "content-type": file.type }, body: file
    });
    if (!uploaded.ok) throw new Error("The file upload did not complete.");
    const point = checkId && TECH_CHECKS.find(x => x.id === checkId);
    await liveWrite("media.finish", {
      fileId: prep.fileId, customerId: r.customer, jobId: roId,
      vehicleId: r.vehicle || undefined,
      tag: kind === "repair" ? "after" : photo ? "issue" : "other",
      mediaPurpose: !photo ? "walkaround" : checkId ? "finding" : "general",
      ...(checkId ? { inspectionItemKey: checkId } : {}),
      caption: point?.name || (kind === "repair" ? "After repair" : photo ? "Inspection evidence" : "Technician walk-through")
    });
    window.location.assign("/automotive?ro=" + encodeURIComponent(roId) + "&tab=media");
  } catch(e) {
    input.disabled = false;
    input.value = "";
    alert(e.message || "Could not save this file to the RO.");
  }
};
photoUploadControl = (r, kind, checkId, label) =>
  '<label class="tech-upload"><span>📷 ' + esc(label || "Take or upload inspection photo") +
  '</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" ' +
  'aria-label="' + esc(label || "Add photo") +
  '" onchange="addTechPhoto(event,\'' + r.id + '\',\'' + esc(kind || "diagnosis") +
  '\',\'' + esc(checkId || "") + '\')"></label>';
videoUploadControl = (r) =>
  '<label class="tech-upload video"><span>🎥 Record or choose customer video</span>' +
  '<input type="file" accept="video/mp4,video/quicktime,video/webm" ' +
  'aria-label="Record or upload video" onchange="addTechVideo(event,\'' + r.id + '\')"></label>';
const originalRoMedia = roMedia;
roMedia = function(r) {
  return originalRoMedia(r).replace(
    "Videos remain in this browser session only and are not sent or uploaded.",
    "Photos and videos are saved securely to this repair order."
  );
};
techMediaGallery = function(r,filter="all") {
  const rows=(r.media||[]).filter(m => filter==="all" || m.category===filter || (filter==="inspection"&&m.category==="diagnosis"));
  return rows.length
    ? '<div class="tech-media-grid">' + rows.map(m =>
       '<article class="tech-media-card"><div class="tech-media-visual">' +
       (m.kind==="video" ? '<video controls playsinline preload="metadata" src="' + esc(m.fileUrl) + '"></video>'
        : '<img alt="' + esc(m.caption || "Inspection photo") + '" src="' + esc(m.fileUrl) + '">') +
       '</div><div class="tech-media-body"><div class="row"><b>' + esc(m.caption || m.name) +
       '</b>' + pill(m.public ? "Customer-visible" : "Internal",m.public?"green":"") +
       '</div><label>Caption<textarea aria-label="Media caption" rows="2" onblur="updateTechMedia(\'' +
       r.id + '\',\'' + m.id + '\',\'caption\',this.value)">' + esc(m.caption || "") +
       '</textarea></label><div class="tech-media-actions">' +
       (manager() ? '<label class="tech-share-check"><input type="checkbox" ' + (m.public?"checked":"") +
        ' onchange="updateTechMedia(\'' + r.id + '\',\'' + m.id + '\',\'public\',this.checked)"> Include in customer packet</label>' : '<span class="sub">Advisor reviews sharing</span>') +
       '<button class="btn small" onclick="removeTechMedia(\'' + r.id + '\',\'' + m.id + '\')">Remove</button>' +
       '</div></div></article>').join("") + '</div>'
    : '<div class="tech-media-empty"><b>No media attached yet</b><p>Use the photo or video picker above. Uploaded evidence is retained on the RO.</p></div>';
};
roPayment=function(r){
  if(techView())return '<div class="notice">Customer payments are not available to technicians.</div>';
  const issued=!!r.invoiceId, due=Math.max(0,Number(r.invoiceBalanceCents||0));
  const records=(r.paymentRows||[]).map(p =>
    '<div class="item"><span class="iconbox">✓</span><div class="item-main"><b>' +
    money(p.amountCents/100) + ' · ' + esc(p.method.replaceAll("_"," ")) + '</b>' +
    '<div class="secondarytext">' + esc(p.at||"") +
    (p.reference ? ' · Ref: '+esc(p.reference) : '') + '</div></div></div>'
  ).join("");
  return '<div class="section-head"><h2>Payment & receipt</h2>' +
    pill(!issued?"Not invoiced":due===0?"Paid":r.invoiceShared?"Payment requested":"Invoice issued",
      due===0&&issued?"green":"amber") + '</div>' +
    '<div class="grid two"><div class="callout"><div class="kpi-label">OUTSTANDING BALANCE</div>' +
    '<div class="finance-head">' + money(due/100) + '</div>' +
    '<div class="metricrow"><span>Invoice</span><b>' +
    (issued ? "#"+esc(String(r.invoiceNumber||"")) : "Not issued") + '</b></div>' +
    '<div class="metricrow"><span>Total invoiced</span><b>' +
    money(Number(r.invoiceTotalCents||0)/100) + '</b></div>' +
    '<div class="metricrow"><span>Email status</span><b>' +
    (r.invoiceEmailSubmitted?"Submitted to provider":issued?"Not confirmed":"Not sent") + '</b></div>' +
    '</div><div class="callout"><h3>Collect & reconcile</h3>' +
    '<p class="sub">Online card payments are collected through the customer invoice link using the shop’s connected payment provider. Manual entries here record money already received; they never charge a card.</p>' +
    (issued&&due>0 ? '<button class="btn primary full" style="margin-top:16px" onclick="openModal(\'collect\',{id:\''+r.id+'\'})">Record received payment</button>' : '') +
    (issued&&!r.invoiceShared ? '<button class="btn full" style="margin-top:12px" onclick="sendInvoice(\''+r.id+'\')">Send invoice & payment link</button>' : '') +
    (issued&&records ? '<button class="btn full" style="margin-top:12px" onclick="openModal(\'receipt\',{id:\''+r.id+'\'})">View actual payment receipts</button>' : '') +
    (issued&&due===0&&!r.released ?
      '<button class="btn primary full" style="margin-top:12px" onclick="closeRo(\''+r.id+'\')">Release vehicle & close RO</button>' : '') +
    (r.released ? '<div class="notice good" style="margin-top:14px">Vehicle released. RO closed.</div>' : '') +
    '</div></div><div class="section-head" style="margin-top:20px"><h3>Recorded payment history</h3>' +
    pill((r.paymentRows||[]).length + ' entry/entries',"blue") + '</div>' +
    (records||'<div class="notice">No payments have been recorded for this invoice.</div>');
};
roInvoice=function(r){
  if(techView())return '<div class="notice">Invoicing belongs to the assigned advisor.</div>';
  return '<div class="section-head"><h2>Customer invoice</h2>' +
    pill(!r.invoiceId?"Ready to issue":r.invoiceEmailSubmitted?"Email submitted":r.invoiceShared?"Link shared":"Issued",
      r.invoiceShared?"green":"blue") + '</div>' +
    (r.stage==="invoice" ? '<div class="card card-pad"><h3>Review completed authorized work</h3><p class="sub">Issue an actual invoice with a payment link; only signed and completed repair work can be billed.</p>' +
      documentPreview(r,"invoice") +
      '<button class="btn primary full" style="margin-top:16px" onclick="sendInvoice(\''+r.id+'\')">Issue invoice & send payment link</button></div>' :
      '<div class="card card-pad"><p class="sub">Invoice #' +
      esc(String(r.invoiceNumber||"—")) + ' · ' +
      (r.invoiceEmailSubmitted?"Customer email submitted":r.invoiceShared?"Payment link shared":"Not yet sent") +
      ' · Remaining '+money(Number(r.invoiceBalanceCents||0)/100)+'</p>' +
      (r.invoiceId&&!r.invoiceShared ? '<button class="btn primary" onclick="sendInvoice(\''+r.id+'\')">Send invoice email</button>' : '') + '</div>');
};

// The signed authorization archive belongs inside its repair order. PDF
// links download the real legally recorded document directly, not an old UI.
roDocuments = function(r) {
  if(techView())return '<div class="notice">Customer financial documents are restricted to the front office.</div>';
  const records=r.authorizationRecords || [];
  const authorizations=records.length ? records.map(record =>
    '<div class="item"><span class="iconbox">✍️</span><div class="item-main"><b>Estimate v' +
    Number(record.version) + ' · ' + (record.signed ? "Signed authorization" : "Awaiting authorization") + '</b>' +
    '<p class="secondarytext">' + esc(record.signed ?
      ('Signed by ' + (record.signedBy || "Customer") + ' · ' + (record.signedAt || "Recorded")) :
      (record.revoked ? "Link revoked" : "Unsigned customer document")) + '</p>' +
    '<p class="secondarytext">' + Number(record.approvedCount) + '/' + Number(record.lineCount) +
    ' repair lines approved</p></div>' +
    (record.signed ? '<a class="btn small" href="/app/estimates/' +
      encodeURIComponent(record.id) + '/authorization.pdf">Download signed PDF</a>' : '') +
    '</div>').join("") :
    '<div class="notice">No estimate versions or authorization records exist for this RO yet.</div>';
  return '<div class="section-head"><h2>Documents & authorization history</h2>' +
    pill(records.length + ' version(s)',"blue") + '</div>' +
    '<p class="sub">All signed decisions remain attached to this repair order. Prior versions are retained.</p>' +
    '<div class="card card-pad" style="margin-top:15px">' + authorizations + '</div>' +
    (r.lines?.length ? '<div class="section-head" style="margin-top:24px"><h3>Customer-facing estimate</h3>' +
      '<button class="btn small" onclick="openCustomerPreview(\'' + r.id + '\')">Preview packet</button></div>' +
      documentPreview(r,"estimate") : '');
};

const originalDashboard = dashboard;
dashboard = function(){
  return originalDashboard()
    .replaceAll("In this demo dataset","In your assigned work")
    .replaceAll("Paid ROs in demo data","Recorded payments in your shop")
    .replaceAll("Try customer approval link","Customer approvals")
    .replaceAll("demo dataset","live shop records");
};
reports = function(){
  const m=data.metrics || {};
  return pageHead("Reports", "Live shop totals from your authorized records.") +
    '<div class="grid stats">'+
      stat("Open repair orders",m.active||0,"Across your accessible work")+
      stat("Open tasks",activeTasks().length,"Workflow-generated")+
      stat("Payments recorded",manager()?money((m.paidCents||0)/100):"Restricted","Based on actual ledger entries")+
      stat("Outstanding",manager()?money((m.outstandingCents||0)/100):"Restricted","Payments not yet collected")+
    '</div><section class="card card-pad"><h2>Shop reporting</h2><p class="sub">View sales, costs, profit, and actual payments in the secure reports system.</p><p style="margin-top:16px">These totals are based on the current, permission-scoped shop data. Owner-only financial reporting will be available here.</p></section>';
};
let stripeSetupBusy = false;
window.openShopStripe = async function(){
  if (role() !== "owner" || !data.paymentSetup?.available || data.paymentSetup?.readOnly || stripeSetupBusy) return;
  stripeSetupBusy = true;
  try {
    const result = await liveWrite("payments.connect", {});
    const target = new URL(result.url);
    if (target.protocol !== "https:" || !(target.hostname === "stripe.com" || target.hostname.endsWith(".stripe.com")))
      throw new Error("The payment provider returned an invalid destination.");
    window.location.assign(target.href);
  } catch(e) {
    alert(e.message || "Could not open Stripe. Please try again.");
  } finally { stripeSetupBusy = false; }
};
window.refreshShopStripe = async function(){
  if (role() !== "owner" || data.paymentSetup?.readOnly || stripeSetupBusy) return;
  stripeSetupBusy = true;
  try {
    if (data.paymentSetup?.connected && data.paymentSetup?.available)
      await liveWrite("payments.refresh", {});
    window.location.assign("/automotive?view=settings");
  } catch(e) {
    alert(e.message || "Could not refresh payment status.");
  } finally { stripeSetupBusy = false; }
};
const shopStripeSettings = function(){
  const p = data.paymentSetup;
  if (role() !== "owner" || !p) return "";
  const label = p.connected ? (p.active ? "Manage Stripe" : "Finish Stripe setup") : "Connect Stripe";
  const status = p.active ? "Stripe connected" : p.connected ? "Finish Stripe setup" : "Not connected";
  const pending = p.platformPending ?
    "Shop Revenue is still activating its online payment service. Your shop can connect after that is finished. There is nothing for you to change in your shop’s Stripe settings yet." :
    "Online payment setup is temporarily unavailable. Check setup status to try again.";
  const outcome = new URLSearchParams(window.location.search).get("stripe");
  const notices = {
    connected: p.active ? "Your Stripe account is connected. Customers can now pay invoices online." : "",
    pending: p.connected && !p.active ? "Your Stripe account is connected. Open Stripe to finish its payment requirements." : "",
    canceled: "Stripe connection canceled. You can connect again when you are ready.",
    expired: "That Stripe connection request expired or was already used. Start again.",
    error: "Stripe could not finish the connection. Start a new connection request."
  };
  const notice = Object.hasOwn(notices, outcome) ? notices[outcome] : "";
  return '<section class="card card-pad" aria-labelledby="shop-payments-heading">' +
    '<div class="section-head"><h2 id="shop-payments-heading">Online payments</h2>' + pill(status, p.active ? "green" : "blue") + '</div>' +
    '<p class="sub">Customers pay your invoices directly into your shop’s connected Stripe account.</p>' +
    (notice ? '<p class="notice" role="status">' + esc(notice) + '</p>' : '') +
    (!p.livemode ? '<p class="notice">Test mode · no real payments</p>' : '') +
    (!p.available ? '<p class="notice" id="shop-stripe-status" role="status">' + esc(pending) + '</p>' :
      !p.connected ? '<ol><li>Select Connect Stripe.</li><li>Sign in to Stripe, or create an account for your shop.</li><li>Approve the connection and complete any business or bank details Stripe requests.</li></ol>' : '') +
    (p.readOnly ? '<p class="sub">Only the signed-in shop owner can change the payment connection.</p>' :
      '<div class="form-actions" style="margin-top:16px;gap:8px;flex-wrap:wrap"><button class="btn" style="min-height:48px" onclick="openShopStripe()"' +
      (!p.available ? ' disabled aria-describedby="shop-stripe-status"' : '') + '>' + label + '</button>' +
      '<button class="btn" style="min-height:48px" onclick="refreshShopStripe()">' + (p.connected ? 'Refresh payment status' : 'Check setup status') + '</button></div>') +
    (p.connected ? '<p style="margin-top:16px"><a class="btn" href="/automotive?view=payments">Account requirements and notifications</a></p>' : '') +
    '<p class="sub" style="margin-top:16px">Stripe processes customer payments. Your Shop Revenue subscription is separate.</p></section>';
};
const shopBillingSettings = function(){
  const b = data.billingSetup;
  if (role() !== "owner" || !b) return "";
  const starting = b.kind === "setup" && !b.trialUsed;
  const status = starting ? "Trial not started" : b.kind === "setup" || b.kind === "locked" ? "Subscription inactive" :
    b.kind === "full" ? (b.trialEndsAt ? "Free trial active" : "Subscription active") :
    b.kind === "comped" ? "Complimentary plan" : b.kind === "grace" ? "Payment needs attention" : b.kind === "off" ? "Billing disabled" : "Billing unavailable";
  const description = starting ?
    "Start your 14-day free trial to add customers and repair orders. A card is required. You can save your business profile before starting your trial." :
    b.blocked ? "Review your Shop Revenue subscription to make changes. You can still view records and save your business profile." :
    "Review your Shop Revenue subscription, card, receipts and cancellation options.";
  return '<section class="card card-pad" aria-labelledby="shop-billing-heading">' +
    '<div class="section-head"><h2 id="shop-billing-heading">Billing</h2>' + pill(status, b.blocked ? "blue" : "green") + '</div>' +
    '<p class="sub">' + description + '</p>' +
    '<p class="sub">This subscription is separate from the Stripe account that receives your customers’ payments.</p>' +
    '<div class="form-actions" style="margin-top:16px"><a class="btn" style="min-height:48px;white-space:normal" href="/automotive?view=billing">' +
    (starting ? "Start free trial" : "Manage billing") + '</a></div></section>';
};
function shopPaymentsPage(){
  const p=data.paymentSetup||{}, requirements=data.paymentRequirements;
  const due=requirements?.due||[];
  const state=!p.connected?"Stripe is not connected":!requirements?.available?"Requirements could not load":due.length?"Action required":requirements.pending?"Verification in progress":requirements.restricted?"Stripe account needs attention":"No outstanding account requirements";
  return '<div class="billing-page">'+pageHead("Account requirements & notifications","Manage customer-payment setup inside your workspace.",'<a class="btn" href="/automotive?view=settings">Back to settings</a>')+
    '<section class="card card-pad"><h2>'+esc(state)+'</h2>'+
    (due.length?'<ul class="payment-requirements-list">'+due.map(label=>'<li>'+esc(label)+'</li>').join("")+'</ul>':'<p class="sub">'+(!requirements?.available?"Open Stripe to check the latest requirements for your account.":requirements.pending?"Stripe is reviewing submitted details. Check Stripe for verification updates.":"Stripe manages your account’s verification and notifications.")+'</p>')+
    '<div class="billing-actions"><button class="btn primary" onclick="openShopStripe()" '+(!p.available||p.readOnly?'disabled':'')+'>'+(p.connected?"Open Stripe account":"Connect Stripe")+'</button><a class="btn" href="/automotive?view=payments">Reload requirements</a></div></section>'+
    '<section class="card card-pad"><h2>Customer payments</h2><p class="sub">Invoice payments go to your connected Stripe account. Subscription billing stays separate.</p></section></div>';
}
function shopAuthorizationSettings(){
  if(role()!=="owner")return "";
  return '<section class="card card-pad"><div class="section-head"><h2>Customer authorization</h2>'+pill(data.authorizationPolicyReady?"Ready to send":"Setup needed",data.authorizationPolicyReady?"green":"amber")+'</div><p class="sub">Review the terms customers sign when they approve work.</p><a class="btn" href="/automotive?view=authorization">'+(data.authorizationPolicyReady?"Review authorization terms":"Set up authorization terms")+'</a></section>';
}
window.saveShopAuthorization=async function(form){
  const values=new FormData(form), submit=form.querySelector('button[type="submit"]'),error=document.getElementById("authorization-error");
  if(submit)submit.disabled=true;
  if(error){error.hidden=true;error.textContent="";}
  try{
    await liveWrite("authorization.enable",{body:String(values.get("body")||""),confirmed:String(values.get("confirmed")||"")});
    const ro=new URLSearchParams(window.location.search).get("returnRo");
    window.location.assign(ro&&data.ros.some(r=>r.id===ro)?"/automotive?ro="+encodeURIComponent(ro)+"&tab=proposal":"/automotive?view=authorization&saved=1");
  }catch(e){if(error){error.textContent=e.message||"Could not enable authorization terms.";error.hidden=false;}if(submit)submit.disabled=false;}
};
function shopAuthorizationPage(){
  const a=data.authorizationSetup||{}, ready=data.authorizationPolicyReady===true;
  return '<div class="billing-page authorization-page">'+pageHead("Customer authorization","The shop owner enables the terms used on customer estimates.",'<a class="btn" href="/automotive?view=settings">Back to settings</a>')+
    '<section class="card card-pad"><h2>'+ (ready?"Document sending is enabled":"Enable document sending")+'</h2>'+
    '<p class="sub">Customers will still choose Approve or Decline for every repair and sign. Enabling these terms does not approve any customer work.</p>'+
    (new URLSearchParams(window.location.search).get("saved")==="1"?'<p class="notice good" role="status">Authorization terms saved. You can now send customer estimates.</p>':"")+
    '<form class="authorization-settings-form" onsubmit="event.preventDefault();saveShopAuthorization(this)"><label for="authorization-body">Customer authorization terms</label><textarea id="authorization-body" name="body" minlength="20" maxlength="8000" rows="10" required placeholder="Enter the terms your shop wants customers to review and sign.">'+esc(data.authorizationPolicyBody||"")+'</textarea>'+
    '<p class="sub">Use your shop’s own terms. Each sent estimate keeps the exact terms and version used at the time. Changing terms creates a new version.</p>'+
    (ready&&a.source==="shop"?'<p class="notice">Updated terms require resending unsigned estimates that used the previous version. Signed records are preserved.</p>':"")+
    '<label class="authorization-confirm"><input type="checkbox" name="confirmed" value="on" required><span>I have reviewed these terms and approve their use for this shop’s customer estimates.</span></label>'+
    '<p id="authorization-error" class="notice warn" role="alert" hidden></p><button class="btn primary full" type="submit" '+(!a.canAct?'disabled':'')+'>'+(ready?"Save and enable updated terms":"Enable document sending")+'</button></form></section></div>';
}
const billingDate = (value) => value ? new Date(value).toLocaleDateString("en-US", {
  timeZone:"America/Chicago", month:"long", day:"numeric", year:"numeric"
}) : "";
let billingBusy = false;
window.manageShopBilling = async function(action, button){
  if (role() !== "owner" || !data.billingDetail?.canAct || billingBusy || !["start","portal"].includes(action)) return;
  billingBusy = true;
  button.disabled = true;
  const error = document.getElementById("billing-error");
  if(error) { error.hidden = true; error.textContent = ""; }
  try {
    const result = await liveWrite("billing." + action, {});
    const target = new URL(result.url);
    if (target.protocol !== "https:" || !["checkout.stripe.com","billing.stripe.com"].includes(target.hostname))
      throw new Error("Stripe returned an invalid billing destination.");
    window.location.assign(target.href);
  } catch(e) {
    if(error) { error.textContent = e.message || "Could not open billing. Try again."; error.hidden = false; }
    button.disabled = false;
    billingBusy = false;
  }
};
const shopBillingPage = function(){
  const b = data.billingDetail;
  if (role() !== "owner" || !b) return pageHead("Billing", "Only the shop owner can manage the subscription.");
  const p = b.pricing || {};
  const trial = b.kind === "full" && b.trialEndsAt;
  const setup = b.kind === "setup";
  const noCharge = ["comped","off"].includes(b.kind);
  const status = b.cancelAt ? "Subscription ending" : p.freeForever && b.kind === "full" ? "Lifetime free" :
    trial ? "Free trial" : b.kind === "full" ? "Subscription active" : setup ? (b.trialUsed ? "Restart subscription" : "Trial not started") :
    b.kind === "comped" ? "Complimentary plan" : b.kind === "off" ? "Billing disabled" : b.kind === "grace" ? "Payment needs attention" :
    b.kind === "locked" ? "Subscription inactive" : "Billing unavailable";
  const price = noCharge ? "$0/month" : p.recurringLabel || "View amount in Stripe";
  let detail = "";
  if (b.cancelAt) detail = "Canceled. Your shop stays active until " + billingDate(b.cancelAt) + ".";
  else if (trial) detail = "Your trial ends " + billingDate(trial) + ". " +
    (p.freeForever ? "Your lifetime discount keeps the subscription at $0 after the trial." :
      p.recurringLabel ? "Your subscription will renew at " + p.recurringLabel + " after the trial." : "Review your discounted renewal amount in Stripe.");
  else if (setup) detail = b.trialUsed ? "Restart your subscription to add customers and repair orders again." :
    "Try Shop Revenue free for 14 days. A card is required. You can add a promotion code at checkout.";
  else if (b.kind === "grace") detail = "Update your payment method by " + billingDate(b.lockAt) + " to keep making changes.";
  else if (b.kind === "locked") detail = "You can view and export your records. Update billing to make changes again.";
  else if (noCharge) detail = "Your shop has full access. There is no subscription charge.";
  else if (b.kind === "unavailable") detail = "Billing is temporarily unavailable. Refresh the status or contact support.";
  else if (p.freeForever) detail = "100% off for the life of this subscription. Your recurring subscription charge is $0.";
  else if (b.currentPeriodEnd) detail = "Next billing period: " + billingDate(b.currentPeriodEnd) + ".";
  const action = setup || b.kind === "locked" && !b.paymentFailed ? "start" : "portal";
  const canManage = b.canAct && !noCharge && b.kind !== "unavailable";
  const buttonLabel = action === "start" ? (b.trialUsed ? "Restart subscription" : "Start free trial") : "Manage billing in Stripe";
  const primary = canManage ? '<button class="btn primary" onclick="manageShopBilling(\'' + action + '\',this)">' + buttonLabel + '</button>' :
    '<a class="btn primary" href="/automotive' + (b.kind === "unavailable" ? '?view=billing' : '') + '">' +
    (b.kind === "unavailable" ? "Refresh billing status" : "Return to workspace") + '</a>';
  const started = new URLSearchParams(window.location.search).has("started");
  const confirmed = ["full","comped","off"].includes(b.kind);
  return '<div class="billing-page">' + pageHead("Billing", "Manage your Shop Revenue subscription.") +
    '<section class="card card-pad" aria-labelledby="billing-plan-heading">' +
    (started ? '<p class="notice ' + (confirmed ? 'good' : '') + '" role="status">' +
      (confirmed ? "Your subscription is confirmed. Your shop is ready to use." : "Your subscription is being confirmed. Refresh billing status to check again.") + '</p>' : '') +
    '<div class="section-head"><h2 id="billing-plan-heading">Shop Revenue</h2>' + pill(status, b.blocked ? "amber" : "green") + '</div>' +
    '<p class="billing-price" aria-label="Recurring subscription price">' + esc(price) + '</p>' +
    (p.freeForever && p.baseLabel ? '<p class="billing-base">Standard price <s>' + esc(p.baseLabel) + '</s></p>' : '') +
    (p.discountLabel ? '<p class="billing-discount">' + esc(p.discountLabel) + '</p>' : '') +
    '<p class="sub billing-dates">' + esc(detail) + '</p>' +
    (!b.canAct ? '<p class="notice" style="margin-top:16px">Support access is read-only. The shop owner manages billing.</p>' : '') +
    '<p id="billing-error" class="notice warn" role="alert" hidden></p>' +
    '<div class="billing-actions">' + primary + '</div></section>' +
    '<section class="card card-pad" aria-labelledby="billing-payment-heading"><h2 id="billing-payment-heading">Your card and receipts</h2>' +
    '<p class="sub">Stripe securely manages your payment method, subscription receipts and cancellation options.</p>' +
    '<p class="sub">Customer invoice payments go to your shop’s connected Stripe account. They are separate from this subscription.</p></section>' +
    '<div class="billing-links"><a class="btn" href="/automotive?view=settings">Back to settings</a>' +
    '<a class="btn" href="/automotive?view=billing">Refresh billing status</a>' +
    '<a class="btn" href="/app/settings/export">Export shop data</a></div></div>';
};
const originalBillingContent = content;
content = function(){
  if(ui.page === "billing") return shopBillingPage();
  if(ui.page === "payments") return shopPaymentsPage();
  if(ui.page === "authorization") return shopAuthorizationPage();
  const b = data.billingSetup;
  const notice = b?.blocked && ui.page !== "settings" ?
    '<section class="notice" data-billing="' + esc(b.kind) + '" aria-label="Subscription setup" style="margin-bottom:16px">' +
    '<p>' + (role() === "owner" ?
      (b.kind === "setup" && !b.trialUsed ? "Start your free trial to add customers and repair orders. Your business profile can be saved now." :
      "Your Shop Revenue subscription needs attention before you can make changes.") :
      "Ask the shop owner to activate the Shop Revenue subscription so you can make changes.") + '</p>' +
    (role() === "owner" ? '<a class="btn" href="/automotive?view=billing" style="margin-top:8px;min-height:48px;white-space:normal">Open billing</a>' : '') + '</section>' : '';
  return notice + originalBillingContent();
};
settings = function(){
  const a=data.settings || {}, members=data.teamMembers || [];
  const teamRows=members.map(m =>
    '<div class="item"><span class="iconbox">👤</span><div class="item-main"><b>' + esc(m.name) +
    '</b><div class="secondarytext">' + esc(m.email || m.phone || "No contact") +
    '</div><div class="secondarytext">' + esc(m.role) + ' · ' + esc(m.status) + '</div></div>' +
    (m.role === "owner" ? pill("Owner","blue") : '<button class="btn small" onclick="openModal(\'editStaff\',{id:\'' + m.id + '\'})">Manage</button>') +
    '</div>').join("");
  const team=manager() ? '<section class="card card-pad"><div class="section-head"><div><h2>Team & permissions</h2><p class="sub">Invite employees and control access without leaving this workspace.</p></div><button class="btn primary" onclick="openModal(\'staff\')">+ Invite employee</button></div>' +
    (teamRows || '<div class="notice">Only you are on this shop. You can manage every step yourself.</div>') + '</section>' :
    '<section class="card card-pad"><h2>My access</h2><p class="sub">Your shop owner manages employee permissions.</p></section>';
  const profile = role() === "owner" ?
    '<form class="formgrid" onsubmit="event.preventDefault();saveBusiness(this)">' +
    (new URLSearchParams(window.location.search).get("saved") === "business" ? '<p class="span notice good" role="status">Business settings saved.</p>' : '') +
    '<label class="span">Business legal name<input name="legalName" maxlength="200" required value="' + esc(a.legalName || data.business) + '"></label>' +
    '<label class="span">Doing business as<input name="dba" maxlength="200" value="' + esc(a.dba || "") + '"></label>' +
    '<label>Phone<input name="phone" value="' + esc(a.phone || "") + '"></label>' +
    '<label>Time zone<input name="timezone" required value="' + esc(a.timezone || "America/Chicago") + '"></label>' +
    '<label class="span">Street address<input name="addressLine1" value="' + esc(a.addressLine1 || "") + '"></label>' +
    '<label>City<input name="city" value="' + esc(a.city || "") + '"></label>' +
    '<label>State<input name="region" value="' + esc(a.region || "") + '"></label>' +
    '<label>Postal code<input name="postalCode" value="' + esc(a.postalCode || "") + '"></label>' +
    '<label>Sales tax (%)<input name="taxPercent" type="number" min="0" max="20" step="0.01" value="' + Number(a.tax || 0) + '"></label>' +
    '<label>Labor selling rate ($/hour)<input name="laborSellRate" type="number" min="0" step="0.01" value="' + Number(a.laborSellRate || 0) + '"></label>' +
    '<label>Labor cost rate ($/hour)<input name="laborCostRate" type="number" min="0" step="0.01" value="' + Number(a.laborCostRate || 0) + '"></label>' +
    '<label class="span"><input name="taxConfirmed" type="checkbox" value="on"> I confirm this is the tax rate I chose for my business.</label>' +
    '<div class="span form-actions"><button class="btn primary">Save business settings</button></div></form>' :
    '<p class="sub">' + esc(data.business) + ' · Automotive Repair</p><p class="secondarytext">Only the owner can change tax or company details.</p>';
  return pageHead("Settings","Your real team, permissions and business details.") +
    '<div class="stack">' + shopBillingSettings() + shopStripeSettings() + shopAuthorizationSettings() + team +
    '<section class="card card-pad"><div class="section-head"><h2>Business profile</h2>' + pill("Automotive Repair","blue") + '</div>' + profile + '</section>' +
    '<section class="card card-pad"><h2>Account & security</h2><p class="sub">Signed in as ' + esc(staff(data.actor).name) + ' · ' + esc(data.currentRole) + '. Role permissions are enforced by your account.</p><form action="/auth/sign-out" method="post" style="margin-top:16px"><button class="btn" type="submit" style="min-height:48px">Sign out</button></form></section></div>';
};
const originalRenderModal = renderModal;
renderModal = function(){
  const m=ui.modal;
  if(m?.type==="proposalRecipient"){
    const recipient=data.customers.find(x=>x.id===m.id);
    if(!recipient || techView())return "";
    return modalWrap("Confirm estimate recipient",
      '<p class="sub">Update the email address used for this repair order\'s secure customer estimate.</p>'+
      '<form style="margin-top:16px" onsubmit="event.preventDefault();saveProposalRecipient(this,\''+m.roId+'\')">'+
      '<label>Customer email<input name="email" type="email" value="'+esc(recipient.email||"")+'" placeholder="customer@example.com" required></label>'+
      '<div class="form-actions"><button class="btn" type="button" onclick="closeModal()">Cancel</button><button class="btn primary">Save email and return to estimate</button></div></form>');
  }
  if(m?.type==="collect"){
    const r=roBy(m.id), due=Math.max(0,Number(r?.invoiceBalanceCents||0));
    if(!r?.invoiceId||!due||techView())return "";
    return modalWrap("Record payment already received",
      '<p class="sub">This records actual funds received outside the app. It does not charge a card or simulate a successful payment.</p>' +
      '<p class="finance-head" style="margin:14px 0">Balance '+money(due/100)+'</p>' +
      '<form onsubmit="event.preventDefault();recordPayment(this,\''+r.id+'\')">' +
      '<label>Amount actually received ($)<input name="amount" type="number" min="0.01" max="'+(due/100).toFixed(2)+'" step="0.01" value="'+(due/100).toFixed(2)+'" required></label>' +
      '<label>Method<select name="method"><option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank transfer</option><option value="external_card">External card payment (already charged)</option></select></label>' +
      '<label>Transaction reference<input name="ref" maxlength="500" placeholder="Receipt or transaction ID"></label>' +
      '<label><input type="checkbox" name="confirmed" required> I confirm that the customer has actually paid this amount.</label>' +
      '<div class="form-actions"><button class="btn" type="button" onclick="closeModal()">Cancel</button><button class="btn primary">Record payment & issue receipt</button></div></form>',true);
  }
  if(m?.type==="receipt"){
    const r=roBy(m.id);
    if(!r || techView())return "";
    const rows=(r.paymentRows||[]).map(p=>
      '<div class="metricrow"><span>'+esc(p.at||"")+' · '+esc(p.method.replaceAll("_"," "))+'</span><b>'+money(p.amountCents/100)+'</b></div>').join("");
    return modalWrap("Actual payment receipts — "+r.num,
      '<div class="preview"><h2>PAYMENT HISTORY</h2><p class="sub">'+esc(customer(r.customer).name)+'</p>' +
      (rows||'<p>No payment recorded.</p>') +
      '<div class="metricrow"><span>Outstanding balance</span><b>'+money(Math.max(0,Number(r.invoiceBalanceCents||0))/100)+'</b></div></div>' +
      '<div class="form-actions"><button class="btn" onclick="window.print()">Print</button><button class="btn primary" onclick="closeModal()">Done</button></div>',true);
  }
  if(m?.type==="customerPacket"){
    const r=roBy(m.id);
    if(!r || techView())return "";
    return modalWrap("Customer packet · read-only preview",
      '<div class="notice">Read-only shop preview. The customer reviews these sections, then makes each approval/decline decision and signs using their secure link. This preview cannot authorize work.</div>'+
      '<div style="margin-top:16px">'+customerPacketPreview(r)+'</div>'+
      '<div class="form-actions"><button class="btn" onclick="closeModal()">Close preview</button></div>',true);
  }
    if(!m || (m.type !== "staff" && m.type !== "editStaff")) return originalRenderModal();
  if(!manager())return "";
  const member=m.id ? (data.teamMembers || []).find(x=>x.id===m.id) : null;
  if(m.id && !member)return "";
  if(member?.role === "owner")return modalWrap("Shop owner","The owner account has every role and cannot be changed here.");
  const roleOptions=[["advisor","Service advisor"],["technician","Technician"],["manager","Manager"]].map(([key,label]) =>
    '<option value="' + key + '" ' + ((member?.role || "advisor")===key?"selected":"") + '>' + label + '</option>').join("");
  const form='<form class="formgrid" onsubmit="event.preventDefault();saveStaff(this,' + (m.id?"\'"+m.id+"\'":"null") + ')">' +
    (member ? '<div class="span notice">Change access for ' + esc(member.name) + '. Assignments and open tasks follow the updated role.</div>' :
    '<label class="span">Employee name<input name="name" required maxlength="100" placeholder="Name"></label>' +
    '<label>Email for secure invitation<input name="email" type="email" placeholder="employee@shop.com"></label>' +
    '<label>Mobile (alternative)<input name="phone" placeholder="(210) 555-0100"></label>') +
    '<label class="span">Role<select name="role">' + roleOptions + '</select></label>' +
    '<div class="span form-actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button>' +
    (member ? '<button type="button" class="btn danger" onclick="removeShopMember(\'' + m.id + '\')">Remove access</button>' : "") +
    '<button class="btn primary">' + (member ? "Save permissions" : "Send invitation") + '</button></div></form>';
  return modalWrap(member ? "Manage employee" : "Invite an employee",form);
};
saveStaff=async function(form,id){
  const f=formData(form);
  try {
    if(id)await liveWrite("team.change",{membershipId:id,role:String(f.role)});
    else await liveWrite("team.invite",{name:String(f.name || ""),email:String(f.email || ""),phone:String(f.phone || ""),role:String(f.role)==="advisor"?"staff":String(f.role)});
    window.location.assign("/automotive?view=settings");
  }catch(e){alert(e.message || "Team change was not saved.");}
};
const removeShopMember=async(id)=>{
  if(!confirm("Remove this employee login and access from the shop?"))return;
  try {await liveWrite("team.remove",{membershipId:id});window.location.assign("/automotive?view=settings");}
  catch(e){alert(e.message || "Could not remove this user.");}
};
saveBusiness=async function(form){
  const f=formData(form);
  try{await liveWrite("business.update",{legalName:String(f.legalName || ""),dba:String(f.dba || ""),phone:String(f.phone || ""),
    addressLine1:String(f.addressLine1 || ""),city:String(f.city || ""),region:String(f.region || ""),postalCode:String(f.postalCode || ""),
    timezone:String(f.timezone || "America/Chicago"),taxPercent:Number(f.taxPercent),
    laborSellRate:Number(f.laborSellRate),laborCostRate:Number(f.laborCostRate),taxConfirmed:!!f.taxConfirmed});
    window.location.assign("/automotive?view=settings&saved=business");
  }catch(e){alert(e.message || "Business settings were not saved.");}
};

// Technician writes must use the actual tenant-guarded inspection, evidence,
// and repair actions. No local-only diagnosis or photo/video upload is accepted.
const originalRoDiagnosis=roDiagnosis;
roDiagnosis=function(r){
  const d=ensureTech(r).diagnosis;
  return originalRoDiagnosis(r).replace('<div class="tech-toolbar">',
    '<div class="tech-field-grid"><label>Bay / work area<input name="bay" required maxlength="120" value="' + esc(d.bay || "") +
    '" placeholder="e.g. Bay 1"></label><label class="tech-share-check">' +
    '<input name="pickedUp" type="checkbox" ' + (d.vehiclePickedUp?"checked":"") +
    '> I have taken possession of this vehicle for diagnosis</label></div>' +
    '<div class="tech-toolbar">');
};
saveDiagnosis=async function(form,id){
  const r=roBy(id);
  if(!r || r.stage!=="inspection")return;
  const f=formData(form);
  if(!f.confirmed || !String(f.symptoms||"").trim() || !String(f.tests||"").trim() ||
     !String(f.cause||"").trim() || !String(f.recommendation||"").trim())
    return alert("Complete all diagnostic findings before continuing.");
  if(!String(f.bay||"").trim() || !f.pickedUp)
    return alert("Enter the bay and confirm vehicle possession.");
  const saved={
    confirmed:String(f.confirmed),codes:String(f.codes||"").trim(),
    symptoms:String(f.symptoms).trim(),tests:String(f.tests).trim(),
    cause:String(f.cause).trim(),recommendation:String(f.recommendation).trim()
  };
  const assessment={diagnosis:JSON.stringify(saved),bay:String(f.bay).trim(),vehiclePickedUp:true};
  if(assessment.diagnosis.length>4000)return alert("Shorten the diagnosis to 4000 characters.");
  try{
    await liveInspectionSave(r,r.inspectionItems,assessment,false);
    r.techData.diagnosis={...saved,bay:assessment.bay,vehiclePickedUp:true,saved:true};
    ui.tab="inspection";render();
  }catch(e){alert(e.message||"Could not save diagnosis.");}
};
setTechCheck=async function(roId,key,result){
  const r=roBy(roId);
  if(!r || r.stage!=="inspection")return;
  const current=r.inspectionItems||[];
  const item=current.find(i=>i.key===key);
  if(!item)return alert("Inspection checkpoint has changed. Reload this RO.");
  const next=current.map(i=>i.key!==key?i:{
    ...i,status:result==="good"?"good":result==="na"?"na":"fix",
    ...(result==="attention"?{}:{note:"",recommendedWork:""})
  });
  try{
    await liveInspectionSave(r,next,persistedInspectionAssessment(r),false);
    const c=r.techData.checks[key]||{};
    r.techData.checks[key]={...c,result,note:result==="attention"?c.note||"":"",};
    const y=window.scrollY;render();window.scrollTo(0,y);
  }catch(e){alert(e.message||"Could not save checkpoint.");}
};
saveTechCheckNote=async function(roId,key,note){
  const r=roBy(roId);
  if(!r || r.stage!=="inspection")return;
  const current=r.inspectionItems||[];
  const item=current.find(i=>i.key===key);
  if(!item)return;
  const finding=String(note||"").trim();
  const next=current.map(i=>i.key!==key?i:{
    ...i,note:finding,
    recommendedWork:i.status==="fix"||i.status==="watch"?finding:""
  });
  try{
    await liveInspectionSave(r,next,persistedInspectionAssessment(r),false);
    r.techData.checks[key]={...(r.techData.checks[key]||{}),note:finding};
  }catch(e){alert(e.message||"Could not save finding.");}
};
addTechPhoto=(event,id,kind,checkId)=>uploadAutomotiveMedia(event,id,kind,checkId);
addTechVideo=(event,id)=>uploadAutomotiveMedia(event,id,"video");
updateTechMedia=async function(roId,mediaId,key,val){
  const r=roBy(roId);
  if(!r?.media?.some(m=>m.id===mediaId))return;
  try {
    await liveWrite("media.update",{
      jobId:roId,mediaId,
      ...(key==="caption" ? {caption:String(val)} : {}),
      ...(key==="public" ? {showCustomer:!!val} : {})
    });
    window.location.assign("/automotive?ro="+encodeURIComponent(roId)+"&tab=media");
  }catch(e){alert(e.message||"Could not update media.");}
};
removeTechMedia=async function(roId,mediaId){
  if(!confirm("Remove this attachment from this repair order?"))return;
  try{
    await liveWrite("media.update",{jobId:roId,mediaId,remove:true});
    window.location.assign("/automotive?ro="+encodeURIComponent(roId)+"&tab=media");
  }catch(e){alert(e.message||"Could not remove media.");}
};
const saveRepairItem=async(r,lineId,next)=>{
  const data=await liveWrite("repair.line",{
    jobId:r.id,versionId:r.estimateId,lineId,
    started:!!next.started,done:!!next.done,notes:String(next.notes||"")
  });
  if(!data)throw new Error("Work progress could not be saved.");
  ensureTech(r).repair[lineId]=next;
  return data;
};
startRepair=async function(roId,lineId){
  const r=roBy(roId);
  if(!r || r.stage!=="repair" || !r.authorized)return;
  const line=ensureTech(r).repair[lineId]||{};
  try{
    await saveRepairItem(r,lineId,{started:true,done:false,notes:line.notes||""});
    const y=scrollY;render();scrollTo(0,y);
  }catch(e){alert(e.message||"Could not start authorized repair.");}
};
saveRepairNotes=async function(roId,lineId,notes){
  const r=roBy(roId);
  if(!r || r.stage!=="repair")return;
  const line=ensureTech(r).repair[lineId]||{};
  try{
    await saveRepairItem(r,lineId,{
      started:!!line.started,done:!!line.done,notes:String(notes||"")
    });
  }catch(e){alert(e.message||"Repair notes were not saved.");}
};
setRepairDone=async function(roId,lineId,done){
  const r=roBy(roId);
  if(!r || r.stage!=="repair")return;
  const line=ensureTech(r).repair[lineId]||{};
  if(done && !String(line.notes||"").trim())
    return alert("Record work performed and parts installed before marking complete.");
  try{
    await saveRepairItem(r,lineId,{started:true,done:!!done,notes:String(line.notes||"")});
    const y=scrollY;render();scrollTo(0,y);
  }catch(e){alert(e.message||"Could not update repair status.");}
};
const persistRepairQa=async(r,updates)=>{
  const t=ensureTech(r);
  const next={
    qualityCheck:updates.qualityCheck===undefined?!!t.qualityCheck:!!updates.qualityCheck,
    postRepairNotes:updates.postRepairNotes===undefined?String(t.postRepairNotes||""):String(updates.postRepairNotes)
  };
  await liveWrite("repair.qa",{jobId:r.id,versionId:r.estimateId,...next});
  Object.assign(t,next);
};
saveFinalQa=async function(id,notes){
  const r=roBy(id);
  if(!r || r.stage!=="repair")return;
  try{await persistRepairQa(r,{postRepairNotes:String(notes||"")});}
  catch(e){alert(e.message||"Final quality notes were not saved.");}
};
toggleFinalQa=async function(id,checked){
  const r=roBy(id);
  if(!r || r.stage!=="repair")return;
  try{
    await persistRepairQa(r,{qualityCheck:!!checked});
    const y=scrollY;render();scrollTo(0,y);
  }catch(e){alert(e.message||"Final quality status was not saved.");}
};
completeWork=async function(id){
  const r=roBy(id);
  if(!r || r.stage!=="repair" || !r.authorized)return;
  const t=ensureTech(r), approved=approvedLines(r);
  if(!approved.length || approved.some(l=>!t.repair[l.id]?.done||!String(t.repair[l.id]?.notes||"").trim()))
    return alert("Complete and document every authorized repair first.");
  if(!t.qualityCheck || !String(t.postRepairNotes||"").trim())
    return alert("Complete the final QA check and notes first.");
  try{
    await liveWrite("repair.finish",{jobId:id,versionId:r.estimateId});
    window.location.assign("/automotive?ro="+encodeURIComponent(id)+"&tab=invoice");
  }catch(e){alert(e.message||"Could not complete repair handoff.");}
};
// Keep the approved customer -> vehicle -> RO hierarchy after saves and reloads.
const initialView=new URLSearchParams(window.location.search);
if(initialView.has("customer")) {
  const id=initialView.get("customer");
  if(data.customers.some(c=>c.id===id)){ui.page="customers";ui.selectedCustomer=id;}
}
if(initialView.has("vehicle")){
  const id=initialView.get("vehicle"),v=data.vehicles.find(v=>v.id===id);
  if(v){ui.page="customers";ui.selectedCustomer=v.customer;ui.selectedVehicle=id;}
}
if(initialView.has("ro")){
  const id=initialView.get("ro");
  if(data.ros.some(r=>r.id===id)){ui.page="jobs";ui.selectedRo=id;}
}
if(["appointments","settings","jobs","tasks","customers","reports"].includes(initialView.get("view")))
  ui.page=initialView.get("view");
if(initialView.get("view") === "billing" && role() === "owner") ui.page="billing";
if(["payments","authorization"].includes(initialView.get("view")) && role() === "owner") ui.page=initialView.get("view");
const originalBillingRender = render;
render = function(){
  document.body.classList.toggle("billing-view", ["billing","payments","authorization"].includes(ui.page));
  originalBillingRender();
};
if(initialView.get("new")==="1" && role()!=="technician"){
  ui.page="jobs";
  ui.modal={
    type:"checkin",
    customerId:initialView.get("customerId")||"",
    vehicleId:initialView.get("vehicleId")||"",
    appointmentId:initialView.get("sourceAppointmentId")||""
  };
}
if(initialView.has("tab") && ui.selectedRo) {
  const tab = initialView.get("tab");
  if(["estimate","proposal","inspection","diagnosis","media","work","invoice","payment","documents","activity"].includes(tab)) {
    ui.tab=tab;
    // A solo owner may wear both hats on the same RO. Deep links into
    // diagnosis or media should open the technician workbench, while the
    // pricing and customer steps remain in the owner/advisor view.
    if(role()==="owner" && ["diagnosis","media"].includes(tab))
      ui.technicianMode=true;
  }
}

