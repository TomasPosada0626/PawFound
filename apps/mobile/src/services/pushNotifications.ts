import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Notificaciones del sistema (Alerta Ángel, círculo de vida, novedades de casos).
 *
 * En modo demostración la app presenta una notificación local cuando el backend simulado
 * genera una para la cuenta actual (funciona en Expo Go). En producción la envía la API por
 * FCM al token del dispositivo, solo después de completar la evaluación de privacidad del
 * proveedor (issue #39, docs/legal/incidentes-y-proveedores.md); la presentación, los
 * canales y el enlace al tocarla son los mismos.
 */

/** Canales de Android: la persona puede silenciar las Alertas Ángel aparte del resto. */
export const CHANNELS = { angel: "angel-alerts", updates: "case-updates" } as const;
export type ChannelId = (typeof CHANNELS)[keyof typeof CHANNELS];

export type PushPermission = "granted" | "denied" | "undetermined";

let handlerSet = false;

export async function configurePush(names: { angel: string; updates: string }): Promise<void> {
  try {
    if (!handlerSet) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      handlerSet = true;
    }
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNELS.angel, {
        name: names.angel,
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: "#6D4AD6",
      });
      await Notifications.setNotificationChannelAsync(CHANNELS.updates, {
        name: names.updates,
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
  } catch {
    // Sin soporte (p. ej. web): la bandeja de la app sigue funcionando.
  }
}

const toPermission = (status: string): PushPermission =>
  status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";

export async function getPushPermission(): Promise<PushPermission> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return toPermission(status);
  } catch {
    return "denied";
  }
}

/** Android 13+ pide el permiso POST_NOTIFICATIONS; antes de eso está concedido por defecto. */
export async function requestPushPermission(): Promise<PushPermission> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return toPermission(status);
  } catch {
    return "denied";
  }
}

export type LocalPush = { title: string; body: string; url: string; channel: ChannelId; silent: boolean };

export async function presentLocal({ title, body, url, channel, silent }: LocalPush): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { url }, sound: silent ? false : "default" },
      trigger: Platform.OS === "android" ? { channelId: channel } : null,
    });
  } catch {
    // Si el sistema rechaza la notificación, queda igual en la bandeja de la app.
  }
}

/** Solo rutas internas: el dato de una notificación nunca abre URLs externas. */
export function safeNotificationUrl(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : null;
}
