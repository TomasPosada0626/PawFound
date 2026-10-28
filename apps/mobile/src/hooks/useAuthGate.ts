import { router } from "expo-router";
import { useCallback } from "react";

import { useCurrentUser } from "@/store/backend";

/**
 * Solo rutas internas como destino post-login: evita que un parámetro `next` manipulado
 * (p. ej. desde un enlace profundo) redirija a un esquema o host externo.
 */
export function safeNext(next: string | string[] | undefined, fallback = "/"): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\:]/.test(value)) return fallback;
  return value;
}

/**
 * Modo exploración (docs/flujos/onboarding-login-registro.md §0): ver es libre; reportar,
 * escribir o unirse a un grupo pide cuenta y teléfono verificado. Devuelve true si se
 * puede continuar; si no, navega al paso que falta y vuelve a `next` al terminar.
 */
export function useAuthGate() {
  const user = useCurrentUser();
  return useCallback(
    (next: string): boolean => {
      if (!user) {
        router.push({ pathname: "/auth/login", params: { next } });
        return false;
      }
      if (!user.phoneVerified) {
        router.push({ pathname: user.phone ? "/auth/verify" : "/auth/phone", params: { next } });
        return false;
      }
      return true;
    },
    [user],
  );
}
