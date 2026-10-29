import type { TKey, TParams } from "@/i18n/core";
import type { ErrorCode } from "@/services/backendTypes";

type T = (key: TKey, params?: TParams) => string;

/**
 * Mensaje para un error de cuenta (registro, inicio de sesión, verificación). "Sin conexión"
 * solo cuando de verdad no hubo red; el resto dice qué pasó para que la persona sepa qué hacer.
 */
export function authErrorMessage(code: ErrorCode, t: T): string {
  switch (code) {
    case "network":
      return t("errors.network");
    case "provider_unavailable":
      return t("errors.email_unavailable");
    case "rate_limited":
      return t("errors.rate_limited");
    case "suspended":
      return t("errors.suspended");
    case "invalid_input":
      return t("errors.invalid_input");
    default:
      return t("errors.unknown");
  }
}
