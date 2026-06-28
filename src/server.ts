import express from "express";
import type { Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import {
  notFoundHandler,
  globalErrorHandler,
} from "./modules/common/errorHandlers.js";
import {
  httpLogger,
  requestContextMiddleware,
} from "./modules/common/httpLogger.js";
import authRouter from "./modules/auth/auth.routes.js";
import meRouter from "./modules/auth/meRoutes/me.routes.js";
import fileRouter from "./modules/files/file.routes.js";
import rootAdminRouter from "./modules/rootAdmin/rootAdmin.routes.js";
import userAdminRouter from "./modules/auth/userRoutes/user.routes.js";

const server = express();

server.use(helmet());
server.use(httpLogger);
server.use(requestContextMiddleware);
server.use(cors({ origin: env.allowedOrigins, credentials: true }));

server.use(express.json({ limit: "5mb" }));
server.use(cookieParser());

// Healthcheck
server.get("/", (req: Request, res: Response) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

server.use("/auth", authRouter);
server.use("/me", meRouter);
server.use("/files", fileRouter);
server.use("/root", rootAdminRouter);
server.use("/users", userAdminRouter);

server.use(notFoundHandler);
server.use(globalErrorHandler);

export default server;
