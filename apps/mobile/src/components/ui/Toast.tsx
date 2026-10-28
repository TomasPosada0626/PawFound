import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { Text } from "./Text";

type ToastTone = "success" | "info" | "error";
type ToastState = { id: number; message: string; tone: ToastTone } | null;

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

/** Confirmaciones breves, anunciadas a TalkBack por región viva. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const seq = useRef(0);
  const insets = useSafeAreaInsets();

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    seq.current += 1;
    setToast({ id: seq.current, message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((current) => (current?.id === toast.id ? null : current)), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="none" className="absolute left-4 right-4 items-center" style={{ bottom: insets.bottom + 104 }}>
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            className="max-w-[480px] flex-row items-center gap-3 rounded-2xl bg-navy px-4 py-3 shadow-lg shadow-black/30"
          >
            <Icon
              name={toast.tone === "error" ? "alert-circle" : toast.tone === "info" ? "information-circle" : "checkmark-circle"}
              size={22}
              color={toast.tone === "error" ? "#FF8A98" : "#5FDCC0"}
            />
            <Text variant="bodyStrong" tone="white" className="shrink">
              {toast.message}
            </Text>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
