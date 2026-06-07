import { AppError } from "./errors";

// Reads a JSON response and fails loudly. Never returns undefined on a bad
// body and never swallows a non-OK status: callers get a typed AppError
// carrying the server message and HTTP status.
export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new AppError(
      `Expected JSON but received a ${response.status} non-JSON response.`,
      response.status || 500,
    );
  }

  if (!response.ok) {
    const errorPayload =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      (typeof (parsed as { error: unknown }).error === "string" ||
        isTypedErrorPayload((parsed as { error: unknown }).error))
        ? (parsed as { error: string | TypedErrorPayload }).error
        : null;

    if (isTypedErrorPayload(errorPayload)) {
      throw new AppError(
        errorPayload.message,
        response.status || 500,
        errorPayload.code,
      );
    }

    const message =
      typeof errorPayload === "string"
        ? errorPayload
        : `Request failed with status ${response.status}.`;

    throw new AppError(message, response.status || 500);
  }

  return parsed as T;
}

type TypedErrorPayload = {
  code: string;
  message: string;
};

function isTypedErrorPayload(value: unknown): value is TypedErrorPayload {
  return (
    value !== null &&
    typeof value === "object" &&
    "code" in value &&
    "message" in value &&
    typeof (value as { code: unknown }).code === "string" &&
    typeof (value as { message: unknown }).message === "string"
  );
}
