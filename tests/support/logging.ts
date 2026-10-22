import { logger, operationId, describeError, redactText } from "@/shared/logging/logger";

// Business fixtures run outside a WebView, where real logging is inert.
export const loggingDependencies = {
  "@/shared/logging/logger": { logger, operationId, describeError, redactText },
};
