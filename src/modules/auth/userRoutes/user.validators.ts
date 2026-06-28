import { z } from "zod";

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export const listUsersQuerySchema = z.object({
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const suspendUserBodySchema = z.object({
  suspended: z.boolean(),
});
