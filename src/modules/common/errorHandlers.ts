import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { HttpError } from "./errors.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "NOT_FOUND", message: "Not Found" });
}

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error(err);
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Validation failed",
      details: (err as ZodError).issues,
    });
  }
  if (err instanceof HttpError) {
    return res
      .status(err.statusCode)
      .json({ error: err.code, message: err.message });
  }
  return res
    .status(500)
    .json({ error: "INTERNAL_SERVER_ERROR", message: "Internal Server Error" });
}
