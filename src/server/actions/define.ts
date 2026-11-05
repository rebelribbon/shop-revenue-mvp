import { assertSessionAssurance } from "../auth/assurance";
import { safeErrorDiagnostic } from "@/lib/errors";
// Server action contract (Section 10): Zod validation with unknown fields
// rejected; caller resolved from the session; one withTenant transaction;
// clientRequestId idempotency stored in request_idempotency (48 h); typed
// errors with a reference ID support can search; support view-as can never
// mutate (forbidden and audited); Owner-only actions checked server-side.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requestIdempotency } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { assertOwner, currentMemberRole } from "@/domain/membership";
import { assertCanMakeChanges } from "@/domain/billing";
import { audit, type RequestMeta } from "@/domain/records";
import { AppError, fromDatabaseError, type ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getSessionState, type ShopSession } from "../auth/session";
import { getRequestMeta } from "../request";

export type ActionError = {
  code: ErrorCode;
  message: string;
  referenceId: string;
  fields?: Record<string, string>;
  // An existing record the input matches (e.g. a customer with the same phone).
  duplicate?: { id: string; name: string };
};
export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: ActionError };

type Ctx = { tx: TenantTx; meta: RequestMeta; session: ShopSession };

export function defineShopAction<S extends z.ZodObject, R, A = R>(cfg: {
  name: string;
  input: S;
  ownerOnly?: boolean;
  technicianAccess?: (tx: TenantTx, input: z.infer<S>) => Promise<void>;
  // Lets an action run while the shop's subscription is inactive (read-only).
  allowWhenUnpaid?: boolean;
  run: (ctx: Ctx, input: z.infer<S>) => Promise<R>;
  // What is stored in request_idempotency and returned on a repeat. Use it to keep
  // secrets (for example a plaintext invite token) out of the database.
  persist?: (result: R) => unknown;
  // Provider calls after commit (never inside the transaction). Its result is
  // what the caller sees; on an idempotent repeat it does not run again.
  afterCommit?: (
    result: R,
    session: ShopSession,
    meta: RequestMeta,
  ) => Promise<A>;
}) {
  const schema = cfg.input.extend({ clientRequestId: z.uuid() }).strict();
  return async (raw: unknown): Promise<ActionResult<A | R>> => {
    const meta = await getRequestMeta();
    try {
      const state = await getSessionState();
      if (state.kind !== "shop")
        throw new AppError("FORBIDDEN", "Please sign in again.");
      const session = state.session;
      if (session.actor.type === "support") {
        await withTenant(
          session.businessId,
          { ...session.actor },
          (tx) =>
            audit(tx, meta, {
              action: "support.mutation_blocked",
              targetType: "action",
              targetId: null,
              after: { action: cfg.name },
            }),
          { supportAudit: true },
        ).catch((e) =>
          logger.error({
            event: "audit.failed",
            requestId: meta.requestId,
            ...safeErrorDiagnostic(e),
          }),
        );
        throw new AppError("FORBIDDEN", "View-as is read-only.");
      }
      await assertSessionAssurance();
      const parsed = schema.safeParse(trimStrings(raw));
      if (!parsed.success) {
        const fields = Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]),
        );
        throw new AppError(
          "VALIDATION",
          "Please check the highlighted fields.",
          { fields },
        );
      }
      const { clientRequestId, ...input } = parsed.data as z.infer<S> & {
        clientRequestId: string;
      };

      let replayed = false;
      const result = await runOnce<R>(
        session,
        meta,
        cfg.name,
        clientRequestId,
        cfg.persist ?? ((r: R) => r),
        async (tx) => {
          if ((await currentMemberRole(tx)) === "technician") {
            if (!cfg.technicianAccess)
              throw new AppError(
                "FORBIDDEN",
                "Ask the front office to do that.",
              );
            await cfg.technicianAccess(tx, input as z.infer<S>);
          }
        },
        async (tx) => {
          if (cfg.ownerOnly) await assertOwner(tx);
          if (!cfg.allowWhenUnpaid) await assertCanMakeChanges(tx);
          return cfg.run({ tx, meta, session }, input as z.infer<S>);
        },
      ).then((r) => {
        replayed = r.replayed;
        return r.value as R;
      });
      const data =
        cfg.afterCommit && !replayed
          ? await cfg.afterCommit(result, session, meta)
          : result;
      logger.info({
        event: "action",
        action: cfg.name,
        requestId: meta.requestId,
        businessId: session.businessId,
        actorType: session.actor.type,
        actorId: session.actor.id,
        outcome: "ok",
        replayed,
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: toActionError(err, meta, cfg.name) };
    }
  };
}

async function runOnce<R>(
  session: ShopSession,
  meta: RequestMeta,
  action: string,
  clientRequestId: string,
  persist: (r: R) => unknown,
  authorize: (tx: TenantTx) => Promise<void>,
  fn: (tx: TenantTx) => Promise<R>,
) {
  const lookup = (tx: TenantTx) =>
    tx
      .select({
        response: requestIdempotency.responseJson,
        action: requestIdempotency.action,
      })
      .from(requestIdempotency)
      .where(
        and(
          eq(requestIdempotency.businessId, tx.businessId),
          eq(requestIdempotency.clientRequestId, clientRequestId),
        ),
      );
  try {
    return await withTenant(session.businessId, session.actor, async (tx) => {
      await authorize(tx);
      const [prior] = await lookup(tx);
      if (prior) {
        if (prior.action !== action)
          throw new AppError(
            "CONFLICT",
            "That request ID was already used for something else.",
          );
        return {
          replayed: true,
          value: (prior.response as { value: R }).value,
        };
      }
      const value = await fn(tx);
      await tx.insert(requestIdempotency).values({
        businessId: tx.businessId,
        clientRequestId,
        action,
        responseJson: { value: persist(value) ?? null },
        createdByUserId: session.userId,
      });
      return { replayed: false, value };
    });
  } catch (err) {
    // A concurrent duplicate committed first: return its stored response.
    if (
      (err as { cause?: { constraint?: string } }).cause?.constraint ===
      "request_idempotency_client_request_key"
    ) {
      const [prior] = await withTenant(
        session.businessId,
        session.actor,
        async (tx) => {
          await authorize(tx);
          return lookup(tx);
        },
      );
      if (prior)
        return {
          replayed: true,
          value: (prior.response as { value: R }).value,
        };
    }
    throw err;
  }
}

export function toActionError(
  err: unknown,
  meta: RequestMeta,
  action: string,
): ActionError {
  const app =
    err instanceof AppError
      ? err
      : fromDatabaseError((err as { cause?: unknown }).cause ?? err);
  if (app) {
    if (app.code === "FORBIDDEN")
      logger.warn({
        event: "action.forbidden",
        action,
        requestId: meta.requestId,
      });
    return {
      code: app.code,
      message: app.message,
      referenceId: meta.requestId,
      fields: app.details?.fields as Record<string, string> | undefined,
      duplicate: app.details?.duplicate as
        { id: string; name: string } | undefined,
    };
  }
  logger.error({
    event: "action.error",
    action,
    requestId: meta.requestId,
    ...safeErrorDiagnostic(err),
  });
  return {
    code: "CONFLICT",
    message: "Something went wrong. Your input was kept; please try again.",
    referenceId: meta.requestId,
  };
}

function trimStrings(v: unknown): unknown {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(trimStrings);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, trimStrings(x)]),
    );
  return v;
}
