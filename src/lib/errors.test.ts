import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AppError,
  GENERIC_CLIENT_MESSAGE,
  logUnexpectedError,
  safeClientMessage,
  safeErrorResponse,
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
