import { t } from "@/shared/i18n/locale";
import { redactText } from "@/shared/logging/logger";

type Failure = { code: string; message: string; detail?: string };

export function commandFailure(reason: unknown): Failure | undefined {
  if (!reason || typeof reason !== "object" || !("code" in reason) || !("message" in reason))
    return;
  if (typeof reason.code !== "string" || typeof reason.message !== "string") return;
  return {
    code: reason.code,
    message: reason.message,
    detail: "detail" in reason && typeof reason.detail === "string" ? reason.detail : undefined,
  };
}

export function errorMessage(reason: unknown, fallback: string): string {
  const failure = commandFailure(reason);
  const message = failure?.message ?? (reason instanceof Error ? reason.message : reason);
  if (typeof message !== "string") return fallback;
  const text = message.trim();
  // Legacy commands still reject strings. Only short, single-line messages are displayable.
  if (
    !text ||
    text.length > 120 ||
    /[\r\n\t]|https?:\/\/|[a-z]:[\\/]|(?:^|\s)\/[\w/]|\b(?:SELECT|INSERT|UPDATE|DELETE|panic|stack backtrace)\b/i.test(
      text,
    )
  )
    return fallback;
  const safe = redactText(text);
  if (safe.includes("[REDACTED]")) return fallback;
  return t(safe);
}
