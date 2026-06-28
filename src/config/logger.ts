import { pino } from "pino";

// pino-pretty yalnızca yerel geliştirmede; prod ve test'te ham JSON (stdout).
// (Test'te LOG_LEVEL=silent ile zaten susturulur; transport worker'ı açılmaz.)
const usePretty =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(usePretty
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
