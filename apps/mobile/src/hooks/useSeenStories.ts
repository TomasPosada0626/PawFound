import { useCallback, useEffect, useSyncExternalStore } from "react";

import { readJSON, STORAGE_KEYS, writeJSON } from "@/services/storage";

/**
 * Partes de historias ya vistas en este dispositivo (anillo gris en la fila). Es una
 * comodidad local: si se pierde, solo vuelven a verse como nuevas.
 */
let seen = new Set<string>();
let loaded = false;
const listeners = new Set<() => void>();
const MAX_SEEN = 500;

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSeenStories() {
  const current = useSyncExternalStore(
    subscribe,
    () => seen,
    () => seen,
  );
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void readJSON<string[]>(STORAGE_KEYS.storiesSeen).then((saved) => {
      if (saved?.length) {
        seen = new Set([...saved, ...seen]);
        emit();
      }
    });
  }, []);
  const markSeen = useCallback((id: string) => {
    if (seen.has(id)) return;
    seen = new Set([...seen, id]);
    emit();
    void writeJSON(STORAGE_KEYS.storiesSeen, [...seen].slice(-MAX_SEEN));
  }, []);
  return { seen: current, markSeen };
}
