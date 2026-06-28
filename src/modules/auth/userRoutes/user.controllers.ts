import type { Request, Response } from "express";
import {
  listUsersPaginated,
  getUserByIdForAdmin,
  setUserSuspended,
} from "../users.service.js";

export async function listUsersHandler(req: Request, res: Response) {
  const { page, limit, q } = (req as any).validatedQuery as {
    page: number;
    limit: number;
    q?: string;
  };
  const result = await listUsersPaginated({ page, limit, q });
  res.json(result);
}

export async function getUserByIdHandler(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const user = await getUserByIdForAdmin(id);
  res.json(user);
}

export async function suspendUserHandler(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { suspended } = req.body as { suspended: boolean };
  const result = await setUserSuspended(id, suspended);
  res.json(result);
}
