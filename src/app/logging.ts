import type { App } from "vue";
import { logger } from "@/shared/logging/logger";

export function installErrorLogging(app: App) {
  app.config.errorHandler = (error, _instance, info) => {
    logger.error("vue", "unhandled_error", error, { context: info });
  };
  globalThis.window.addEventListener("error", (event) => {
    logger.error("app", "uncaught_error", event.error ?? event.message);
  });
  globalThis.window.addEventListener("unhandledrejection", (event) => {
    logger.error("app", "unhandled_rejection", event.reason);
  });
  logger.info("app", "frontend_started");
}
