import { changedBilledLines } from "@/lib/supplement";
import { shareRecipient } from "./document-sharing";
import { partLineCents } from "./job-costing";
import { sealShareToken } from "@/lib/share-token";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  activity,
  business,
  legalPolicy,
  invoice,
  estimateRecommendationLine,
  estimateAuthorization,
  authorizationSummaryColumns,
  estimateVersion,
  recommendation,
  type EstimateSnapshot,
} from "@/db/schema";
import { type TenantTx, runInContext } from "@/db/tenant";
import { jobInput } from "./jobs";
import { serviceAssetLabel } from "./service-assets";
import { getCustomerWithVehicles, getVehicle } from "./customers";
import { newToken, hashToken, isWellFormedToken } from "@/lib/tokens";
import { AppError, notFound } from "@/lib/errors";
import { audit, recordActivity, type RequestMeta } from "./records";
import { estimateTotals } from "@/lib/estimate-tax";
import { automaticEstimateChanges } from "@/lib/estimate-changes";
import { repeatSummary } from "@/lib/service-plans";
import { estimatePhotos } from "./job-media";
import { completeAdvisorHandoff } from "./job-handoffs";
import { getInspection } from "./inspections";
import type { EstimateInspection } from "@/db/schema/m3";
import {
  completeDecisions,
  signatureSchema,
  lineDecisionSchema,
  type LineDecision,
  type SignatureStrokes,
} from "@/lib/estimate-decisions";
import { authorizationPdf } from "./authorization-pdf";
import { z¶»§q«^