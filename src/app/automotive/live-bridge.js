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
  if(type==="staff"||type==="editStaff") return nativePage("/app/settings/team");
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
addLine = function(id){nativeRo(id);};
removeLine = function(id){nativeRo(id);};
setApproval = function(){alert("Use the actual secure customer approval link sent from the RO.");};
saveContact = function(form,id){nativePage("/app/customers/" + encodeURIComponent(id));};
saveStaff = function(){nativePage("/app/settings/team");};
saveBusiness = function(){nativePage("/app/settings/business");};
resetDemo = function(){alert("Live shop records cannot be reset.");};
exportData = function(){nativePage("/app/reports");};
launchCustomerDemo = function(){nativePage("/app/jobs");};
openCustomerPreview = function(id){nativeRo(id);};
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
// The source design's file pickers are local-only. Never let technicians choose
// attachments that could be discarded before a real upload occurs.
photoUploadControl = function (r, kind, checkId, label) {
  return '<a class="tech-upload" href="/app/jobs?job=' + encodeURIComponent(r.id) +
    '&tab=photos" aria-label="Open secure photo upload">📷 ' + esc(label || "Take or upload inspection photo") + '</a>';
};
videoUploadControl = function (r) {
  return '<a class="tech-upload video" href="/app/jobs?job=' + encodeURIComponent(r.id) +
    '&tab=photos" aria-label="Open secure video upload">🎥 Record or upload customer video</a>';
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
  const name=esc(data.business);
  return pageHead("Settings","Manage your real team, business, and payment setup.")+
  '<div class="grid two"><section class="card card-pad"><h2>'+name+'</h2><p class="sub">Automotive Repair · authenticated account</p><div class="stack" style="margin-top:18px"><a class="btn full" href="/app/settings/team">Team & permissions</a><a class="btn full" href="/app/settings/business">Business profile</a><a class="btn full" href="/app/settings/billing">Subscription & billing</a><a class="btn full" href="/app/settings">Other settings</a></div></section><section class="card card-pad"><h2>Signed in</h2><p class="sub">'+esc(staff(data.actor).name)+' · '+esc(data.currentRole)+'</p><p style="margin-top:18px"><a class="btn" href="/auth/sign-out">Sign out</a></p><div class="notice" style="margin-top:18px">Access is assigned by the shop owner or manager. Employee role switching is disabled in the live application.</div></section></div>';
};
// Technician writes must use the actual tenant-guarded inspection, evidence,
// and repair actions. No local-only diagnosis or photo/video upload is accepted.
saveDiagnosis=function(id){nativeRo(id);};
setTechCheck=function(id){nativeRo(id);};
saveTechCheckNote=function(id){nativeRo(id);};
addTechPhoto=function(event,id){if(event)event.target.value="";nativeRo(id);};
addTechVideo=function(event,id){if(event)event.target.value="";nativeRo(id);};
updateTechMedia=function(id){nativeRo(id);};
removeTechMedia=function(id){nativeRo(id);};
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

