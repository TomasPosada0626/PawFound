import { ApiBackend } from "./apiBackend";
import type { MockBackend } from "./mockBackend";

/**
 * Interfaz que usan las pantallas: la implementan el backend de demostración (MockBackend, en
 * memoria) y el real (ApiBackend, sobre la API). Se elige con EXPO_PUBLIC_API_URL.
 */
export type Backend = Pick<MockBackend, keyof MockBackend>;

export function createApiBackend(baseUrl: string): Backend {
  return new ApiBackend(baseUrl.replace(/\/+$/, ""));
}
