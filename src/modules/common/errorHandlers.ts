import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { HttpError } from "./errors.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "NOT_FOUND" });
}

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.log(err);
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      details: (err as ZodError).issues,
    });
  }
  if (err instanceof HttpError) {
    return res
      .status(err.statusCode)
      .json({ Error: err.code, message: err.message });
  }
  return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
}
