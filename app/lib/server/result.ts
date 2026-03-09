// @input: re-exports from lib/shared/result
// @output: Result<T,E>, AppError, ok(), err(), toResponse() — canonical server import path
// @position: server-layer alias — keeps lib/server imports self-contained

export {
  type AppError,
  type Result,
  ok,
  err,
  toResponse,
} from "@/lib/shared/result";
