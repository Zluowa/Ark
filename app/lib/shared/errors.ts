// @input: error context (optional details, custom messages)
// @output: pre-defined Result<never, AppError> factory functions for common error cases
// @position: shared error vocabulary — prevents ad-hoc error code strings across the codebase

import { err, type Result, type AppError } from "./result";

export const authFailed = (message = "Invalid API key."): Result<never, AppError> =>
  err("AUTH_FAILED", message, 401);

export const authMissing = (message = "Missing API key."): Result<never, AppError> =>
  err("AUTH_MISSING", message, 401);

export const authForbidden = (
  requiredScopes: string[],
): Result<never, AppError> =>
  err(
    "AUTH_FORBIDDEN",
    `Missing required scope(s): ${requiredScopes.join(", ")}`,
    403,
    { required_scopes: requiredScopes },
  );

export const quotaExceeded = (
  message = "Quota exceeded.",
  details?: unknown,
): Result<never, AppError> => err("QUOTA_EXCEEDED", message, 429, details);

export const toolNotFound = (toolId: string): Result<never, AppError> =>
  err("TOOL_NOT_FOUND", `Tool not found: ${toolId}`, 404);

export const validationError = (message: string): Result<never, AppError> =>
  err("VALIDATION_ERROR", message, 400);

export const rateLimited = (
  retryAfterSec: number,
): Result<never, AppError> =>
  err("RATE_LIMITED", "Too many requests.", 429, { retry_after_sec: retryAfterSec });

export const internalError = (message = "Internal server error."): Result<never, AppError> =>
  err("INTERNAL_ERROR", message, 500);
