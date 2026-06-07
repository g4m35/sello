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
