// Structured JSON logs, one line per event (Section 20). Never logged: message
// bodies, customer names, full phone numbers, emails, tokens, signature data,
// EINs, card data, raw webhook payloads. The redaction list is the backstop;
// call sites pass IDs, not personal data.
import pino from "pino";

export const REDACT_PATHS = [
  "*.token",
  "*.inviteToken",
  "*.password",
  "*.authorization",
  "*.cookie",
  "*.body",
  "*.payload",
  "*.email",
  "*.phone",
  "*.phoneE164",
  "*.signature",
  "*.ein",
  "*.card",
  "token",
  "inviteToken",
  "body",
  "payload",
  "email",
  "phone",
  "phoneE164",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "web", env: process.env.APP_ENV ?? "local" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  formatters: { level: (label) => ({ level: label }) },
});

// Public-link paths carry tokens; route logging masks the token segment (Section 16).
export const maskTokenPath = (path: string) =>
  path.replace(/^\/(e|i|r|invite)\/[^/?#]+/, "/$1/[token]");
