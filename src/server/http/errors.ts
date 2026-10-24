import { HTTP_STATUS, type ApiError, type ErrorCode } from "@/contracts/common";

/** An error that maps directly onto the ApiError contract. */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toBody(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const unauthenticated = (message = "Sign in required.") =>
  new HttpError("unauthenticated", message);

export const forbidden = (message = "You are not allowed to do that.") =>
  new HttpError("forbidden", message);

export const notFound = (message = "Not found.") =>
  new HttpError("not_found", message);

export const conflict = (message = "Conflict.") =>
  new HttpError("conflict", message);

export const validationFailed = (message = "Invalid request.", details?: unknown) =>
  new HttpError("validation_failed", message, details);

export const upstreamFailed = (message = "Upstream service failed.") =>
  new HttpError("upstream_failed", message);

export const internal = (message = "Internal error.") =>
  new HttpError("internal", message);
