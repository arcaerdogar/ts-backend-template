import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../../config/logger.js";
import { requestContext } from "./requestContext.js";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Her isteğe bir request/correlation ID atar (gelen X-Request-Id varsa onu
 * kullanır, yoksa üretir), yanıt header'ında geri verir ve isteğin
 * tamamlanmasını otomatik loglar. `req.log` child logger'ı id'yi taşır.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
});

/**
 * requestId'yi AsyncLocalStorage bağlamına koyar ki tüm alt katmanlar
 * (service'ler dâhil) elle taşımadan erişebilsin. httpLogger'dan SONRA gelmeli.
 */
export function requestContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  requestContext.run({ requestId: String(req.id) }, () => next());
}
