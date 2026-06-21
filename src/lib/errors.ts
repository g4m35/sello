import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ConfigurationError extends AppError {
  constructor(variableName: string) {
    super(`Missing required environment variable: ${variableName}`, 503);
    this.name = "ConfigurationError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export function getRequiredEnv(variableName: string): string {
  const value = process.env[variableName];

  if (!value || value.startsWith("[") || value.includes("[")) {
    throw new ConfigurationError(variableName);
  }

  return value;
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

// Generic seller-facing copy for any error that is not an author-written AppError.
// Used so raw Prisma / eBay / provider / DB internals (which can embed query text,
// stack traces, connection strings, or tokens) never reach a normal API response.
export const GENERIC_CLIENT_MESSAGE =
  "Something went wrong on our end. Please try again.";

const INVALID_REQUEST_MESSAGE =
  "The request was invalid. Please check the fields and try again.";

/**
 * Logs an UNEXPECTED failure server-side under a stable label. Expected errors
 * (AppError, ZodError) are not logged here. Only the error class name and any
 * structured `code` are logged — never `error.message`, because Prisma/provider
 * messages can embed secrets (tokens, connection strings, raw payloads).
 */
export function logUnexpectedError(label: string, error: unknown): void {
  if (error instanceof AppError || error instanceof ZodError) return;
  const name = error instanceof Error ? error.name : typeof error;
  const code =
    error && typeof error === "object" && "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  console.error(`[${label}] unexpected error: ${name}${code ? ` (${code})` : ""}`);
}

/**
 * Resolves a client-safe message string for an error. AppError messages are
 * author-written and safe to surface as-is; ZodError collapses to a generic
 * validation message; anything else collapses to a generic message so raw
 * internals never leak. Pass `opts.label` to also log unexpected errors.
 */
export function safeClientMessage(
  error: unknown,
  opts: { label?: string; fallback?: string } = {},
): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof ZodError) return INVALID_REQUEST_MESSAGE;
  if (opts.label) logUnexpectedError(opts.label, error);
  return opts.fallback ?? GENERIC_CLIENT_MESSAGE;
}

// --- Persisted marketplace failure reasons -----------------------------------
// Internal failure fields (publishAttempt.reason, marketplaceListing.lastError,
// adapterResult.ebayError) are surfaced in admin/debug panels, so they must never
// store raw provider payloads, DB internals, stack traces, or secret-like strings.

const SAFE_PERSISTED_FAILURE_FALLBACK = "The marketplace request failed.";

const UNSAFE_FAILURE_PATTERNS: readonly RegExp[] = [
  /\bbearer\b/i,
  /\bauthorization\b/i,
  /(?:access|refresh)[_-]?token/i,
  /\bapi[_-]?key\b/i,
  /\bsecret\b/i,
  /\bpassword\b/i,
  /\bset-cookie\b|\bcookie\s*[:=]/i,
  /\bprisma\b/i,
  /deserialize column/i,
  /pg_advisory/i,
  /\n\s*at\s+/, // multi-line stack trace
  /\bat\s+\S*[:(]\S*:\d+:\d+/, // single stack frame "at fn (/path:1:2)"
  /[{[]\s*["']?[\w$-]+["']?\s*:/, // JSON / object payload with a key
  /<\/?[a-z][^>]*>/i, // XML / HTML markup payload
];

/** True when text looks like a raw payload, stack trace, DB internal, or secret. */
export function isUnsafePersistedFailureText(text: string): boolean {
  if (text.length > 200) return true;
  return UNSAFE_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Scrub a string for safe persistence/render. Clean short messages pass through;
 * anything that looks like a payload/stack/DB/secret collapses to `fallback`.
 */
export function safeFailureText(
  text: string | null | undefined,
  fallback: string = SAFE_PERSISTED_FAILURE_FALLBACK,
): string {
  if (typeof text !== "string") return fallback;
  const trimmed = text.trim();
  if (!trimmed || isUnsafePersistedFailureText(trimmed)) return fallback;
  return trimmed;
}

/**
 * Safe summary to persist for a marketplace failure. Author-written AppError /
 * EbayIntegrationError messages are candidates (still scrubbed, in case they
 * embedded raw provider text); a raw Error/unknown never has its message
 * persisted. The failure CODE is stored separately, so the troubleshooting
 * category survives even when the message is replaced.
 */
export function safePersistedFailureReason(
  error: unknown,
  fallback: string = SAFE_PERSISTED_FAILURE_FALLBACK,
): string {
  const candidate = error instanceof AppError ? error.message : null;
  return safeFailureText(candidate, fallback);
}

export type SafeErrorResponse = {
  status: number;
  body: { error: { code: string; message: string } };
};

/**
 * Builds a sanitized `{ status, body }` for an API route's catch block, using the
 * `{ error: { code, message } }` shape. AppError keeps its status/code/message
 * (author-written, safe). ZodError becomes a 400 INVALID_REQUEST. Everything else
 * is logged (class + code only) and collapsed to a stable code + generic message
 * at `fallbackStatus` (default 500) — no raw Prisma/eBay/provider/DB text.
 */
export function safeErrorResponse(
  error: unknown,
  opts: {
    label: string;
    fallbackCode?: string;
    fallbackMessage?: string;
    fallbackStatus?: number;
  },
): SafeErrorResponse {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { error: { code: error.code ?? "REQUEST_FAILED", message: error.message } },
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { error: { code: "INVALID_REQUEST", message: INVALID_REQUEST_MESSAGE } },
    };
  }
  logUnexpectedError(opts.label, error);
  return {
    status: opts.fallbackStatus ?? 500,
    body: {
      error: {
        code: opts.fallbackCode ?? "REQUEST_FAILED",
        message: opts.fallbackMessage ?? GENERIC_CLIENT_MESSAGE,
      },
    },
  };
}
