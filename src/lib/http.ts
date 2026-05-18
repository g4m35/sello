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
    const message =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `Request failed with status ${response.status}.`;

    throw new AppError(message, response.status || 500);
  }

  return parsed as T;
}
