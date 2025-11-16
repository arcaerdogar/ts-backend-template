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

  static unauthorized(
    message = "You are not authorized for this action",
    code = "UNAUTHORIZED"
  ) {
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
