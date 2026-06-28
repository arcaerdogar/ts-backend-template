import { z } from "zod";

export const rootLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const manageSystemAdminSchema = z.object({
  userId: z.uuid(),
  assign: z.boolean(),
});
