import { useEffect, useState } from "react";

/**
 * Hora actual que se refresca sola: mantiene al día los "Hace X min" y hace crecer el
 * círculo de vida en pantalla sin recargar.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
