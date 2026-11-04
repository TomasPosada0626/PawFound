// Constantes y tipos del modo demostración. Las reglas coinciden con las de la API.

import type { Lang, NotificationKind, NotificationPrefs, PrivacyPrefs } from "@/domain/types";

/** Código de verificación en modo demostración (la API real lo envía al correo). */
export const DEMO_CODE = "123456";
export const RESEND_COOLDOWN_S = 45;
export const CODE_TTL_MIN = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const LOCK_MINUTES = 5;
export const MESSAGE_MAX = 1000;
/** Nombre de un punto de encuentro ("Parque de Laureles"). */
export const LOCATION_LABEL_MAX = 60;
/** Máximo de personas que la familia puede agradecer al cerrar un caso. */
export const MAX_HELPERS = 5;
export const MAX_OWNED_PETS = 10;
/** Antispam: mensajes por minuto por cuenta. */
export const MESSAGES_PER_MINUTE = 12;
export const ALERT_KINDS = new Set<NotificationKind>(["angel_alert", "life_circle"]);

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  lostNearby: true,
  foundNearby: true,
  comments: true,
  directMessages: true,
  groups: true,
  lifeCircle: true,
  angelAlerts: true,
  friendAlerts: true,
  quietHours: false,
  quietFrom: "22:00",
  quietTo: "07:00",
  push: true,
  email: true,
  dailyDigest: false,
};

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = { whoCanMessage: "everyone" };

export type Listener = () => void;

/**
 * Traductor de mensajes. En producción lo implementa la API con un proveedor evaluado
 * (docs/legal/incidentes-y-proveedores.md); en demo no hay traductor y los mensajes
 * nuevos se muestran en su idioma original, sin inventar traducciones.
 */
export type Translator = (text: string, from: Lang, to: Lang) => string | null;

export type BackendOptions = {
  now?: () => Date;
  translator?: Translator;
  /** Contraseñas de demostración por correo (en minúsculas). */
  credentials?: Record<string, string>;
};
