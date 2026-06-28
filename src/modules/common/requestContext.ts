import { AsyncLocalStorage } from "node:async_hooks";

type RequestStore = { requestId: string };

/**
 * İstek-kapsamlı bağlam. İstek başında requestId burada saklanır; derin
 * katmanlardaki kod (örn. service'lerdeki recordAuthEvent) `req`'i elle
 * taşımadan bu id'ye erişebilir. Log üretmez; sadece id'yi taşır.
 */
export const requestContext = new AsyncLocalStorage<RequestStore>();

/** Mevcut isteğin id'si (istek bağlamı dışında undefined). */
export const getRequestId = (): string | undefined =>
  requestContext.getStore()?.requestId;
