export const ERRORS = {
  // Auth
  NO_TOKEN: "no_token",
  INVALID_TOKEN: "invalid_token",
  NO_REFRESH_COOKIE: "no_refresh_cookie",
  INVALID_CREDENTIALS: "invalid_credentials",
  EMAIL_IN_USE: "email_in_use",
  UNAUTHORIZED: "unauthorized",
  NO_ACCESS: "no_access",

  // Validation
  VALIDATION_ERROR: "validation_error",

  // Generic
  INTERNAL_ERROR: "internal_error",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  CONFLICT_UNIQUE: "conflict_unique",

  // Refresh token / sessions
  BAD_TOKEN_FORMAT: "bad_token_format",
  REVOKED: "revoked",
  EXPIRED: "expired",
  HASH_MISMATCH: "hash_mismatch",
  STALE_AFTER_PASSWORD_CHANGE: "stale_after_password_change",
} as const;

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly message: string,
    public readonly code: string
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message = "Bad Request", code = "BAD_REQUEST") {
    return new HttpError(400, message, code);
  }

  static conflict(message = "Conflict", code = "CONFLICT") {
    return new HttpError(409, message, code);
  }

  static unauthorized(message = "Unauthorized", code = "UNAUTHORIZED") {
    return new HttpError(401, message, code);
  }

  static forbidden(message = "Forbidden", code = "FORBIDDEN") {
    return new HttpError(403, message, code);
  }

  static notFound(message = "Not Found", code = "NOT_FOUND") {
    return new HttpError(404, message, code);
  }

  static internal(message = "Internal Server Error") {
    return new HttpError(500, message, "INTERNAL_ERROR");
  }
}
