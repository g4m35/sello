import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AppError,
  GENERIC_CLIENT_MESSAGE,
  isUnsafePersistedFailureText,
  logUnexpectedError,
  safeClientMessage,
  safeErrorResponse,
  safeFailureText,
  safePersistedFailureReason,
} from "./errors";

// A stand-in for a raw Prisma runtime error: a multi-line message that embeds the
// internal "void" deserialization detail plus query text and a token-like string.
function prismaVoidError(): Error {
  const error = new Error(
    "Inconsistent column data: Failed to deserialize column of type 'void'. " +
      "Invocation: SELECT pg_advisory_xact_lock(...). token=tok_live_should_never_leak",
  );
  error.name = "PrismaClientKnownRequestError";
  (error as Error & { code?: string }).code = "P2023";
  return error;
}

afterEach(() => vi.restoreAllMocks());

describe("safeClientMessage", () => {
  it("returns author-written AppError messages verbatim", () => {
    expect(safeClientMessage(new AppError("Item not found", 404))).toBe("Item not found");
  });

  it("collapses raw Prisma errors to a generic message (no internals leak)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const message = safeClientMessage(prismaVoidError(), { label: "test" });
    expect(message).toBe(GENERIC_CLIENT_MESSAGE);
    expect(message).not.toContain("void");
    expect(message).not.toContain("Prisma");
    expect(message).not.toContain("pg_advisory");
    expect(message).not.toContain("tok_live");
  });

  it("collapses ZodError to a generic validation message", () => {
    let zodError: unknown;
    try {
      z.object({ id: z.string() }).parse({});
    } catch (error) {
      zodError = error;
    }
    const message = safeClientMessage(zodError);
    expect(message.toLowerCase()).toContain("invalid");
    // No raw Zod issue detail (field paths, "Required", "expected ...") leaks.
    expect(message).not.toContain("Required");
    expect(message.toLowerCase()).not.toContain("expected");
    expect(message).not.toContain('"id"');
  });
});

describe("logUnexpectedError", () => {
  it("logs only the error class and code, never the raw message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logUnexpectedError("comps_refresh", prismaVoidError());
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = String(spy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("comps_refresh");
    expect(logged).toContain("PrismaClientKnownRequestError");
    expect(logged).toContain("P2023");
    expect(logged).not.toContain("void");
    expect(logged).not.toContain("tok_live");
    expect(logged).not.toContain("pg_advisory");
  });

  it("does not log expected AppError / ZodError", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logUnexpectedError("test", new AppError("nope", 400));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("safeErrorResponse", () => {
  it("preserves AppError status, code, and message", () => {
    const { status, body } = safeErrorResponse(new AppError("Nope", 403, "DENIED"), {
      label: "test",
    });
    expect(status).toBe(403);
    expect(body).toEqual({ error: { code: "DENIED", message: "Nope" } });
  });

  it("sanitizes unexpected errors to a stable code + generic message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = safeErrorResponse(prismaVoidError(), {
      label: "comps_refresh",
      fallbackCode: "COMPS_REFRESH_FAILED",
      fallbackMessage: "Couldn't refresh comps right now. Manual comps still work.",
    });
    expect(status).toBe(500);
    expect(body.error.code).toBe("COMPS_REFRESH_FAILED");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("void");
    expect(serialized).not.toContain("Prisma");
    expect(serialized).not.toContain("pg_advisory");
    expect(serialized).not.toContain("tok_live");
    expect(serialized).not.toMatch(/Invocation:/);
  });

  it("maps ZodError to a 400 INVALID_REQUEST", () => {
    let zodError: unknown;
    try {
      z.object({ id: z.string() }).parse({});
    } catch (error) {
      zodError = error;
    }
    const { status, body } = safeErrorResponse(zodError, { label: "test" });
    expect(status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});

describe("persisted marketplace failure sanitization", () => {
  // The exact dangerous strings that must never reach publishAttempt.reason,
  // marketplaceListing.lastError, adapterResult.ebayError, or any debug surface.
  const DANGEROUS = [
    "PrismaClientKnownRequestError: invalid `prisma.x()` invocation",
    "Inconsistent column data: Failed to deserialize column of type 'void'.",
    "Authorization: Bearer abc.def.ghi",
    "oauth failed: refresh_token expired",
    '{"errors":[{"errorId":25001,"message":"System error","longMessage":"secret"}]}',
    "TypeError: x is undefined\n    at Object.<anonymous> (/app/src/publish.ts:10:15)",
    "<errorResponse><message>raw eBay xml payload</message></errorResponse>",
    "api_key=sk_live_TOKEN_should_never_persist",
    "SELECT pg_advisory_xact_lock(...) returned void",
  ];

  const SAFE = [
    "The item specifics are invalid for this category.",
    "eBay could not end this listing.",
    "This listing needs a few more details before it can go live.",
  ];

  it("flags every dangerous sample as unsafe", () => {
    for (const sample of DANGEROUS) {
      expect(isUnsafePersistedFailureText(sample)).toBe(true);
    }
  });

  it("lets clean short business messages through", () => {
    for (const sample of SAFE) {
      expect(isUnsafePersistedFailureText(sample)).toBe(false);
      expect(safeFailureText(sample)).toBe(sample);
    }
  });

  it("safeFailureText replaces dangerous content with a generic fallback", () => {
    for (const sample of DANGEROUS) {
      const out = safeFailureText(sample);
      expect(out).toBe("The marketplace request failed.");
      expect(out).not.toContain("Prisma");
      expect(out).not.toContain("void");
      expect(out).not.toContain("Bearer");
      expect(out).not.toContain("refresh_token");
      expect(out).not.toContain("pg_advisory");
      expect(out).not.toMatch(/[{<]/);
      expect(out).not.toMatch(/\bat\s+\S+:\d+:\d+/);
    }
  });

  it("flags over-long blobs as unsafe", () => {
    expect(isUnsafePersistedFailureText("a".repeat(201))).toBe(true);
  });

  it("safeFailureText handles null/empty with the fallback", () => {
    expect(safeFailureText(null)).toBe("The marketplace request failed.");
    expect(safeFailureText("   ")).toBe("The marketplace request failed.");
    expect(safeFailureText(undefined, "custom fallback")).toBe("custom fallback");
  });

  it("safePersistedFailureReason scrubs raw Error messages but keeps clean AppError text", () => {
    const raw = new Error(
      "PrismaClientKnownRequestError: Authorization: Bearer leaked.token",
    );
    raw.name = "PrismaClientKnownRequestError";
    expect(safePersistedFailureReason(raw)).toBe("The marketplace request failed.");

    // Author-written AppError with a clean message passes through.
    expect(
      safePersistedFailureReason(new AppError("eBay could not end this listing.", 502)),
    ).toBe("eBay could not end this listing.");

    // Even an AppError whose message embedded raw text is scrubbed.
    expect(
      safePersistedFailureReason(
        new AppError('eBay API request failed: {"errors":[{"errorId":1}]}', 502),
      ),
    ).toBe("The marketplace request failed.");

    expect(safePersistedFailureReason("not even an error", "fallback")).toBe("fallback");
  });
});
