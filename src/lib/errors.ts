// Typed error codes (Section 10). Messages are plain words; codes drive the UI.
export const ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "FORBIDDEN",
  "INVALID_TRANSITION",
  "CONFLICT",
  "PROVIDER_UNAVAILABLE",
  "NOT_ELIGIBLE",
  "RATE_LIMITED",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "That record") => new AppError("NOT_FOUND", `${what} was not found.`);
export const forbidden = (message = "You can't do that.") => new AppError("FORBIDDEN", message);

type PgError = { code?: string; message?: string; constraint?: string };

// Maps database errors raised by our constraints and triggers to typed codes.
export function fromDatabaseError(err: unknown): AppError | null {
  const e = err as PgError;
  if (!e || typeof e.code !== "string") return null;
  const msg = e.message ?? "";
  if (msg.startsWith("INVALID_TRANSITION")) return new AppError("INVALID_TRANSITION", "That change isn't allowed right now.");
  if (msg.startsWith("MEMBERSHIP_LIMIT")) return new AppError("CONFLICT", "This business already has two people with access.");
  if (msg.startsWith("TENANT_MISMATCH")) return new AppError("FORBIDDEN", "That record belongs to a different business.");
  if (e.code === "23505") return new AppError("CONFLICT", "That already exists.", { constraint: e.constraint });
  if (e.code === "23503") return new AppError("NOT_FOUND", "A linked record was not found.", { constraint: e.constraint });
  if (e.code === "23514") return new AppError("VALIDATION", "Some values are not allowed.", { constraint: e.constraint });
  if (e.code === "42501") return new AppError("FORBIDDEN", "You can't do that.");
  if (e.code === "25006") return new AppError("FORBIDDEN", "Read-only access.");
  return null;
}

// Serialization failures and deadlocks are retried (Section 19).
export const isRetryableDatabaseError = (err: unknown) => ["40001", "40P01"].includes((err as PgError)?.code ?? "");
