/**
 * Validaciones de formularios. Devuelven códigos de error (no textos) para que la UI
 * los traduzca; la API vuelve a validar todo — el cliente nunca es la última barrera.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/**
 * Normaliza un celular colombiano a E.164 (+57 3XX XXX XXXX).
 * Acepta espacios, guiones, paréntesis y el prefijo 57/+57. Devuelve null si no es válido.
 * Solo celulares (empiezan por 3): la verificación es por SMS.
 */
export function normalizeColombianMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  const national = digits.startsWith("57") && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^3\d{9}$/.test(national)) return null;
  return `+57${national}`;
}

/** "+573001234567" → "+57 300 123 4567" */
export function formatColombianMobile(e164: string): string {
  const n = e164.replace(/^\+57/, "");
  return `+57 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}

export type PasswordIssue = "too_short" | "needs_upper" | "needs_lower" | "needs_number";

export const PASSWORD_MIN_LENGTH = 8;

export function passwordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  // Contraseña segura: 8+ caracteres con mayúscula, minúscula y número (igual en la API).
  if (password.length < PASSWORD_MIN_LENGTH) issues.push("too_short");
  if (!/[A-ZÁÉÍÓÚÑ]/.test(password)) issues.push("needs_upper");
  if (!/[a-záéíóúñü]/.test(password)) issues.push("needs_lower");
  if (!/\d/.test(password)) issues.push("needs_number");
  return issues;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Nombre de usuario: 3 a 20 letras minúsculas, números o _ (se acepta con @ adelante). */
export function normalizeUsername(raw: string): string | null {
  const username = raw.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(username) ? username : null;
}

/** Se entra con el correo o con el nombre de usuario. */
export type LoginForm = { identifier: string; password: string };

export function validateLogin(form: LoginForm): FieldErrors<keyof LoginForm> {
  const errors: FieldErrors<keyof LoginForm> = {};
  const id = form.identifier.trim();
  if (!id) errors.identifier = "required";
  else if (id.includes("@") && !id.startsWith("@") && !isValidEmail(id)) errors.identifier = "invalid_email";
  else if ((!id.includes("@") || id.startsWith("@")) && !normalizeUsername(id)) errors.identifier = "invalid_username";
  if (!form.password) errors.password = "required";
  return errors;
}

export type RegisterForm = {
  /** Nombre y apellidos. */
  name: string;
  email: string;
  username: string;
  password: string;
  confirm: string;
  acceptTerms: boolean;
  confirmAge: boolean;
};

export function validateRegister(form: RegisterForm): FieldErrors<keyof RegisterForm> {
  const errors: FieldErrors<keyof RegisterForm> = {};
  const words = form.name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (!form.name.trim()) errors.name = "required";
  else if (words.length < 2) errors.name = "needs_surname";
  if (!form.email.trim()) errors.email = "required";
  else if (!isValidEmail(form.email)) errors.email = "invalid_email";
  if (!form.username.trim()) errors.username = "required";
  else if (!normalizeUsername(form.username)) errors.username = "invalid_username";
  const issues = passwordIssues(form.password);
  if (issues.length > 0) errors.password = issues[0];
  if (!form.confirm) errors.confirm = "required";
  else if (form.confirm !== form.password) errors.confirm = "password_mismatch";
  if (!form.acceptTerms) errors.acceptTerms = "required";
  if (!form.confirmAge) errors.confirmAge = "required";
  return errors;
}

export const DESCRIPTION_MAX = 500;
export const BIO_MAX = 150;
export const MAX_PHOTOS = 5;

export type ReportFormFields = {
  kind: "lost" | "found";
  name: string;
  species: string | null;
  description: string;
  photos: string[];
  hasLocation: boolean;
};

export function validateReport(form: ReportFormFields): FieldErrors<keyof ReportFormFields> {
  const errors: FieldErrors<keyof ReportFormFields> = {};
  if (form.kind === "lost" && !form.name.trim()) errors.name = "required";
  if (!form.species) errors.species = "required";
  if (form.photos.length === 0) errors.photos = "photo_required";
  if (form.photos.length > MAX_PHOTOS) errors.photos = "too_many_photos";
  if (form.description.length > DESCRIPTION_MAX) errors.description = "too_long";
  if (!form.hasLocation) errors.hasLocation = "location_required";
  return errors;
}

export function hasErrors(errors: Record<string, unknown>): boolean {
  return Object.values(errors).some(Boolean);
}
