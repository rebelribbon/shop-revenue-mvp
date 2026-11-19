/* eslint-disable @next/next/no-location-assign-relative-destination */

/* This adapter is the only mutable surface of the approved HTML shell.
   The live app never uses the prototype's browser storage or simulated actions. */
const nativeRo = (id) => {
  window.location.assign("/app/jobs?job=" + encodeURIComponent(id));
};
const nativePage = (path) => window.location.assign(path);
const nativeWarning = (id) => {
  if (id) nativeRo(id);
  else window.alert("This operation is available in the secure shop workspace.");
};
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
  if (id) return nativePage("/app/schedule");
  const f=formData(form);
  try{
    await liveWrite("appointment.create",{
      customerId:String(f.customer || ""),vehicleId:String(f.vehicle || ""),
      startsAt:String(f.date || "")+"T"+String(f.time || "09:00"),
      reason:String(f.purpose || ""),notes:""
    });
    window.location.assign("/automotive?view=appointments");
  }catch(e){alert(e.message || "Appointment not scheduled.");}
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
  if(type==="collect"||type==="receipt") return nativeWarning(extra && extra.id || ui.selectedRo);
  return originalOpenModal(type,extra);
};
submitInspection = function(id){nativeRo(id);};
submitInspectionComplete = function(id){nativeRo(id);};
sendEstimate = function(id){nativeRo(id);};
submitApproval = function(id){nativeRo(id);};
completeWork = function(id){nativeRo(id);};
sendInvoice = function(id){nativeRo(id);};
recordPayment = function(form,id){nativeRo(id);};
closeRo = function(id){nativeRo(id);};
const centsFromForm = (amount) => {
  const text = String(amount ?? "").trim();
  if (!/^(?:0|[1-9]\\d{0,6})(?:\\.\\d{1,2})?$/.test(text))
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
      partsCents, laborCents, costCents
    });
    showPricedRo(id);
  } catch(e) { alert(e.message || "Recommendation was not saved."); }
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
saveContact = function(form,id){nativePage("/app/customers/" + encodeURIComponent(id));};
saveStaff = function(){nativePage("/app/settings/team");};
saveBusiness = function(){nativePage("/app/settings/business");};
resetDemo = function(){alert("Live shop records cannot be reset.");};
exportData = function(){nativePage("/app/reports");};
launchCustomerDemo = function(){nativePage("/app/jobs");};
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
  return originalHeader()
    .replace("● Automotive · Offline preview", "● Automotive · Live workspace")
    .replace(/<button class="btn small" onclick="openModal\('role'\)">.*?<\/button>/, '<span class="pill blue">Signed in · ' + esc(role()) + '</span>');
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
      mediaPurpose: photo ? "general" : "walkaround",
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
roPayment = function (r) {
  if (techView()) return '<div class="notice">Payments are not visible to technicians.</div>';
  return '<div class="section-head"><h2>Payment & receipt</h2>' +
    pill(r.paid ? "Paid" : r.invoiceSent ? "Awaiting payment" : "Not invoiced",
      r.paid ? "green" : "amber") + '</div>' +
    '<div class="card card-pad"><p class="sub">Invoices, collected payments, refunds, and receipts are managed in the authenticated RO ledger. No test payments or simulated receipts are created here.</p>' +
    '<p style="margin-top:16px"><a class="btn primary" href="/app/jobs?job=' +
    encodeURIComponent(r.id) + '">Open invoice & secure payments</a></p></div>';
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
    '</div><section class="card card-pad"><h2>Shop reporting</h2><p class="sub">View sales, costs, profit, and actual payments in the secure reports system.</p><p style="margin-top:16px"><a class="btn primary" href="/app/reports">Open complete reports</a></p></section>';
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
    '<div class="stack">' + team +
    '<section class="card card-pad"><div class="section-head"><h2>Business profile</h2>' + pill("Automotive Repair","blue") + '</div>' + profile + '</section>' +
    '<section class="card card-pad"><h2>Account & security</h2><p class="sub">Signed in as ' + esc(staff(data.actor).name) + ' · ' + esc(data.currentRole) + '. Role permissions are enforced by your account.</p><p style="margin-top:16px"><a class="btn" href="/auth/sign-out">Sign out</a></p></section></div>';
};
const originalRenderModal = renderModal;
renderModal = function(){
  const m=ui.modal;
  if(m?.type==="customerPacket"){
    const r=roBy(m.id);
    if(!r || techView())return "";
    return modalWrap("Customer document packet — shop preview",
      '<div class="notice">Preview only: this screen cannot sign for the customer. Actual approve/decline decisions and signature are collected through the secure customer link.</div>' +
      '<div style="margin-top:16px">' + documentPreview(r,"estimate") + '</div>' +
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
    window.location.assign("/automotive?view=settings");
  }catch(e){alert(e.message || "Business settings were not saved.");}
};

// Technician writes must use the actual tenant-guarded inspection, evidence,
// and repair actions. No local-only diagnosis or photo/video upload is accepted.
saveDiagnosis=function(id){nativeRo(id);};
setTechCheck=function(id){nativeRo(id);};
saveTechCheckNote=function(id){nativeRo(id);};
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
startRepair=function(id){nativeRo(id);};
saveRepairNotes=function(id){nativeRo(id);};
setRepairDone=function(id){nativeRo(id);};
saveFinalQa=function(id){nativeRo(id);};
toggleFinalQa=function(id){nativeRo(id);};
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
if(initialView.get("view")==="appointments")ui.page="appointments";
if(initialView.get("view")==="settings")ui.page="settings";
if(initialView.has("tab") && ui.selectedRo) {
  const tab = initialView.get("tab");
  if(["estimate","proposal","inspection","diagnosis","media","work","invoice","payment","documents","activity"].includes(tab))ui.tab=tab;
}

