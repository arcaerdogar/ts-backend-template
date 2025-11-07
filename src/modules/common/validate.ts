import type { Request, Response, NextFunction } from "express";
import type { ZodSchema, ZodTypeAny, ZodType } from "zod";

function makeHandler<T extends ZodType<any,any,any>>(
  schema: T,
  getData: (req: Request) => unknown,
  setData: (req: Request, data: unknown) => void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = (schema as ZodSchema).safeParse(getData(req));
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "validation_error", details: parsed.error.issues });
    }
    setData(req, parsed.data);
    next();
  };
}

export function validateBody<T extends ZodType<any,any,any>>(schema: T) {
  return makeHandler(schema, (req) => req.body, (req, data) => {
    (req as any).body = data;
  });
}

export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return makeHandler(schema, (req) => req.query, (req, data) => {
    (req as any).validatedQuery = data;
  });
}

export function validateParams<T extends ZodTypeAny>(schema: T) {
  return makeHandler(schema, (req) => req.params, (req, data) => {
    (req as any).params = data;
  });
}


