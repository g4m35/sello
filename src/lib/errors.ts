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
