import { logger, operationId, describeError, redactText } from "@/shared/logging/logger";

// Most business fixtures run outside a WebView. Real logging is inert there;
// tests/shared/logging exercises transport failures and duplicate suppression separately.
export const loggingDependencies = {
  "@/shared/logging/logger": { logger, operationId, describeError, redactText },
};
