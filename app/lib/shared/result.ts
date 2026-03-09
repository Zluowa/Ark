// @input: generic data T and error type E (defaults to AppError)
// @output: type-safe Result<T,E>, AppError type, and response conversion utilities
// @position: foundation layer — used by all server modules that need typed error handling

import { NextResponse } from "next/server";

export type AppError = {
  code: string;
  message: string;
  status: number;
  details?: unknown;
};

export type Result<T, E extends AppError = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });

export const err = (
  code: string,
  message: string,
  status = 500,
  details?: unknown,
): Result<never, AppError> => ({
  ok: false,
  error: { code, message, status, details },
});

export const toResponse = (result: Result<unknown>): NextResponse => {
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  const { code, message, status, details } = result.error;
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
};
