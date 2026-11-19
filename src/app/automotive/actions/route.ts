import { NextResponse } from "next/server";
import { getSessionState } from "@/server/auth/session";
import {
  createCustomerAction,
  updateCustomerAction,
  createVehicleAction,
} from "@/server/actions/customers";
import { checkInAction } from "@/server/actions/check-in";
import { freezeEstimateAction } from "@/server/actions/estimates";
import {
  issueInvoiceAction,
  recordInvoicePaymentAction,
} from "@/server/actions/invoices";
import { recordJobProgressAction } from "@/server/actions/job-workflow";
import { releaseAutomotiveRoAction } from "@/server/actions/automotive-release";
import {
  saveAutomotiveRepairLineAction,
  saveAutomotiveRepairQaAction,
  finishAutomotiveRepairAction,
} from "@/server/actions/automotive-repairs";
import {
  emailCustomerDocument,
  prepareDocumentShare,
} from "@/server/actions/document-sharing";
import { recordJobSharingAction } from "@/server/actions/job-workflow";
import { saveInspectionAction } from "@/server/actions/inspections";
import {
  inviteStaffAction,
  changeTeamAccessAction,
  removeStaffAction,
} from "@/server/actions/team";
import { updateBusinessProfileAction } from "@/server/actions/business";
import {
  prepareMediaUploadAction,
  finishMediaUploadAction,
  updateMediaAction,
} from "@/server/actions/job-media";
import {
  addAutomotiveRecommendationAction,
  removeAutomotiveRecommendationAction,
} from "@/server/actions/automotive-pricing";
import {
  createAppointmentAction,
  rescheduleAppointmentAction,
  setAppointmentStatusAction,
} from "@/server/actions/appointments";
import { recordCorrespondenceAction } from "@/server/actions/correspondence";
import {
  assignCustomerAction,
  assignJobAction,
  assignAdvisorAction,
} from "@/server/actions/assignments";

export const dynamic = "force-dynamic";

function value(v: unknown): string {
  return typeof v === "string" ? v : "";
}
const id = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : "";
const numberOrNull = (v: unknown) =>
  v === null || v === "" || v === undefined ? null : Number(v);

export async function POST(request: Request) {
  const state = await getSessionState();
  if (state.kind !== "shop" || state.session.actor.type !== "user")
    return NextResponse.json(
      {
        ok: false,
        error: {
          message:
            "This operation requires an authenticated front-office employee.",
        },
      },
      { status: 403 },
    );
  let raw: Record<string, unknown>;
  try {
    const bytes = await request.text();
    if (bytes.length > 14000) throw new Error("Payload exceeds limit.");
    const parsed: unknown = JSON.parse(bytes);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid operation.");
    raw = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: { message: "Invalid request." } },
      { status: 400 },
    );
  }
  // Technicians can upload only media for assigned work. The underlying
  // actions enforce assigned-customer and assigned-RO access server-side.
  const technicianOperation =
    raw.operation === "inspection.save" ||
    raw.operation === "work.progress" ||
    raw.operation === "repair.line" ||
    raw.operation === "repair.qa" ||
    raw.operation === "repair.finish" ||
    raw.operation === "media.prepare" ||
    raw.operation === "media.finish" ||
    raw.operation === "media.update";
  if (state.session.role === "technician" && !technicianOperation)
    return NextResponse.json(
      {
        ok: false,
        error: { message: "This action is for the service advisor." },
      },
      { status: 403 },
    );
  const payload = (
    raw.payload &&
    typeof raw.payload === "object" &&
    !Array.isArray(raw.payload)
      ? raw.payload
      : {}
  ) as Record<string, unknown>;
  const clientRequestId = id(raw.clientRequestId) || crypto.randomUUID();
  const actor = state.session.actor.id;
  try {
    let result;
    switch (raw.operation) {
      case "inspection.save":
        result = await saveInspectionAction({
          clientRequestId,
          jobId: id(payload.jobId),
          items: value(payload.items),
          submit: payload.submit === true,
          assessment: payload.assessment,
        });
        break;
      case "media.prepare":
        result = await prepareMediaUploadAction({
          clientRequestId,
          customerId: id(payload.customerId),
          contentType: value(payload.contentType),
          byteSize: Number(payload.byteSize),
        });
        break;
      case "media.finish":
        result = await finishMediaUploadAction({
          clientRequestId,
          fileId: id(payload.fileId),
          customerId: id(payload.customerId),
          jobId: id(payload.jobId),
          ...(id(payload.vehicleId)
            ? { vehicleId: id(payload.vehicleId) }
            : {}),
          tag: value(payload.tag),
          mediaPurpose: value(payload.mediaPurpose),
          caption: value(payload.caption),
        });
        break;
      case "media.update":
        result = await updateMediaAction({
          clientRequestId,
          mediaId: id(payload.mediaId),
          jobId: id(payload.jobId),
          ...(payload.remove === true ? { remove: "true" } : {}),
          ...(typeof payload.caption === "string"
            ? { caption: value(payload.caption) }
            : {}),
          ...(typeof payload.showCustomer === "boolean"
            ? { showCustomer: payload.showCustomer ? "true" : "false" }
            : {}),
        });
        break;
      case "team.invite":
        result = await inviteStaffAction({
          clientRequestId,
          name: value(payload.name),
          email: value(payload.email),
          phone: value(payload.phone),
          role: value(payload.role),
        });
        break;
      case "team.change":
        result = await changeTeamAccessAction({
          clientRequestId,
          membershipId: id(payload.membershipId),
          role: value(payload.role),
        });
        break;
      case "team.remove":
        result = await removeStaffAction({
          clientRequestId,
          membershipId: id(payload.membershipId),
        });
        break;
      case "business.update":
        result = await updateBusinessProfileAction({
          clientRequestId,
          legalName: value(payload.legalName),
          dba: value(payload.dba),
          phone: value(payload.phone),
          addressLine1: value(payload.addressLine1),
          city: value(payload.city),
          region: value(payload.region),
          postalCode: value(payload.postalCode),
          timezone: value(payload.timezone),
          taxPercent: Number(payload.taxPercent),
          laborSellRate: Number(payload.laborSellRate),
          laborCostRate: Number(payload.laborCostRate),
          ...(payload.taxConfirmed === true ? { taxConfirmed: "on" } : {}),
        });
        break;
      case "estimate.freeze":
        result = await freezeEstimateAction({
          clientRequestId,
          jobId: id(payload.jobId),
          expectedJobVersion: id(payload.expectedJobVersion),
          taxBps: Number(payload.taxBps),
          supplementReason: value(payload.supplementReason),
          terms: value(payload.terms),
        });
        break;
      case "document.prepare": {
        const shared = await prepareDocumentShare({
          id: id(payload.id),
          kind: value(payload.kind),
        });
        result = shared.ok
          ? { ok: true as const, data: shared.data }
          : { ok: false as const, error: { message: shared.message } };
        break;
      }
      case "document.email": {
        const delivery = await emailCustomerDocument({
          id: id(payload.id),
          kind: value(payload.kind),
          email: value(payload.email),
          documentIds: [],
        });
        result = delivery.ok
          ? { ok: true as const, data: { message: delivery.message } }
          : { ok: false as const, error: { message: delivery.message } };
        break;
      }
      case "document.shared":
        result = await recordJobSharingAction({
          clientRequestId,
          jobId: id(payload.jobId),
          documentId: id(payload.documentId),
          kind: value(payload.kind),
        });
        break;
      case "repair.line":
        result = await saveAutomotiveRepairLineAction({
          clientRequestId,
          jobId: id(payload.jobId),
          versionId: id(payload.versionId),
          lineId: id(payload.lineId),
          started: payload.started === true,
          done: payload.done === true,
          notes: value(payload.notes),
        });
        break;
      case "repair.qa":
        result = await saveAutomotiveRepairQaAction({
          clientRequestId,
          jobId: id(payload.jobId),
          versionId: id(payload.versionId),
          qualityCheck: payload.qualityCheck === true,
          postRepairNotes: value(payload.postRepairNotes),
        });
        break;
      case "repair.finish":
        result = await finishAutomotiveRepairAction({
          clientRequestId,
          jobId: id(payload.jobId),
          versionId: id(payload.versionId),
        });
        break;
      case "work.progress":
        result = await recordJobProgressAction({
          clientRequestId,
          jobId: id(payload.jobId),
          versionId: id(payload.versionId),
          expectedStatus: value(payload.expectedStatus),
          status: value(payload.status),
          note: value(payload.note),
        });
        break;
      case "invoice.issue":
        result = await issueInvoiceAction({
          clientRequestId,
          versionId: id(payload.versionId),
          dueOn: value(payload.dueOn),
          terms: value(payload.terms),
        });
        break;
      case "payment.record":
        result = await recordInvoicePaymentAction({
          clientRequestId,
          invoiceId: id(payload.invoiceId),
          amountCents: Number(payload.amountCents),
          method: value(payload.method),
          reference: value(payload.reference),
        });
        break;
      case "ro.release":
        result = await releaseAutomotiveRoAction({
          clientRequestId,
          jobId: id(payload.jobId),
        });
        break;
      case "customer.create":
        result = await createCustomerAction({
          clientRequestId,
          firstName: value(payload.firstName),
          lastName: value(payload.lastName),
          phone: value(payload.phone),
          email: value(payload.email),
          addressLine1: value(payload.addressLine1),
          notes: value(payload.notes),
          assignedUserId: id(payload.assignedUserId) || actor,
        });
        break;
      case "customer.update":
        result = await updateCustomerAction({
          clientRequestId,
          customerId: id(payload.customerId),
          firstName: value(payload.firstName),
          lastName: value(payload.lastName),
          phone: value(payload.phone),
          email: value(payload.email),
          addressLine1: value(payload.addressLine1),
          notes: value(payload.notes),
        });
        break;
      case "vehicle.create":
        result = await createVehicleAction({
          clientRequestId,
          customerId: id(payload.customerId),
          year: numberOrNull(payload.year),
          mileage: numberOrNull(payload.mileage),
          make: value(payload.make),
          model: value(payload.model),
          vin: value(payload.vin).toUpperCase(),
          plate: value(payload.plate),
        });
        break;
      case "ro.checkin":
        result = await checkInAction({
          approvedInspection: true,
          clientRequestId,
          customerId: id(payload.customerId),
          vehicleId: id(payload.vehicleId),
          mileageIn: numberOrNull(payload.mileageIn),
          concerns: value(payload.concerns),
          technicianUserId: id(payload.technicianUserId) || null,
          ...(id(payload.sourceAppointmentId)
            ? { sourceAppointmentId: id(payload.sourceAppointmentId) }
            : {}),
        });
        break;
      case "ro.pricing.add":
        result = await addAutomotiveRecommendationAction({
          clientRequestId,
          jobId: id(payload.jobId),
          expectedVersion: id(payload.expectedVersion),
          description: value(payload.description),
          partsCents: Number(payload.partsCents),
          laborCents: Number(payload.laborCents),
          costCents: Number(payload.costCents),
        });
        break;
      case "ro.pricing.remove":
        result = await removeAutomotiveRecommendationAction({
          clientRequestId,
          jobId: id(payload.jobId),
          expectedVersion: id(payload.expectedVersion),
          description: value(payload.description),
        });
        break;
      case "correspondence.log":
        result = await recordCorrespondenceAction({
          clientRequestId,
          customerId: id(payload.customerId),
          channel: value(payload.channel),
          outcome: value(payload.outcome),
          summary: value(payload.summary),
        });
        break;
      case "appointment.reschedule":
        result = await rescheduleAppointmentAction({
          clientRequestId,
          appointmentId: id(payload.appointmentId),
          startsAt: value(payload.startsAt),
        });
        break;
      case "appointment.status":
        result = await setAppointmentStatusAction({
          clientRequestId,
          appointmentId: id(payload.appointmentId),
          status: value(payload.status),
        });
        break;
      case "appointment.create":
        result = await createAppointmentAction({
          clientRequestId,
          customerId: id(payload.customerId),
          vehicleId: id(payload.vehicleId),
          startsAt: value(payload.startsAt),
          reason: value(payload.reason),
          notes: value(payload.notes),
        });
        break;
      case "customer.assign":
        result = await assignCustomerAction({
          clientRequestId,
          customerId: id(payload.customerId),
          userId: id(payload.userId),
        });
        break;
      case "ro.assign-tech":
        result = await assignJobAction({
          clientRequestId,
          jobId: id(payload.jobId),
          userId: id(payload.userId),
        });
        break;
      case "ro.assign-advisor":
        result = await assignAdvisorAction({
          clientRequestId,
          jobId: id(payload.jobId),
          userId: id(payload.userId),
        });
        break;
      default:
        return NextResponse.json(
          {
            ok: false,
            error: { message: "Unknown or unsupported workflow action." },
          },
          { status: 400 },
        );
    }
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          message:
            "The operation could not be completed. No demo record was created.",
        },
      },
      { status: 500 },
    );
  }
}
