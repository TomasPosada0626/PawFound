import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

import type { User } from "@/domain/types";
import { API_URL } from "@/config";
import { createApiBackend, type Backend } from "@/services/backend";
import type { BackendState } from "@/services/backendTypes";
import { MockBackend } from "@/services/mockBackend";
import { createSeed } from "@/services/seed";

const BackendContext = createContext<Backend | null>(null);

export function createDemoBackend(now?: () => Date): MockBackend {
  const { state, credentials } = createSeed(now ? now() : new Date());
  return new MockBackend(state, { now, credentials });
}

export function BackendProvider({ backend, children }: { backend?: Backend; children: ReactNode }) {
  // Una sola instancia por árbol: el inicializador perezoso de useState corre una vez. Con
  // EXPO_PUBLIC_API_URL se usa la API real; sin ella, la demostración en memoria.
  const [instance] = useState<Backend>(() => backend ?? (API_URL ? createApiBackend(API_URL) : createDemoBackend()));
  return <BackendContext.Provider value={instance}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error("useBackend debe usarse dentro de <BackendProvider>");
  return backend;
}

/** Estado completo (referencia estable hasta el próximo cambio). Derivar con useMemo. */
export function useBackendState(): BackendState {
  const backend = useBackend();
  return useSyncExternalStore(backend.subscribe, backend.getSnapshot, backend.getSnapshot);
}

export function useCurrentUser(): User | null {
  const state = useBackendState();
  return state.sessionUserId ? (state.users[state.sessionUserId] ?? null) : null;
}
