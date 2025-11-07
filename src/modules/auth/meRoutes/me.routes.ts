import { Router } from "express";
import { authGuard } from "../../common/authGuard.js";
import { asyncHandler } from "../../common/asyncHandler.js";
import { getSelfInfo } from "./me.controllers.js";

const r = Router();

r.get("/", authGuard, asyncHandler(getSelfInfo));

export default r;
