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

export type PasswordIssue = "too_short" | "needs_letter" | "needs_number";

export const PASSWORD_MIN_LENGTH = 8;

export function passwordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push("too_short");
  if (!/[A-Za-zÀ-ÿ]/.test(password)) issues.push("needs_letter");
  if (!/\d/.test(password)) issues.push("needs_number");
  return issues;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type LoginForm = { email: string; password: string };

export function validateLogin(form: LoginForm): FieldErrors<keyof LoginForm> {
  const errors: FieldErrors<keyof LoginForm> = {};
  if (!form.email.trim()) errors.email = "required";
  else if (!isValidEmail(form.email)) errors.email = "invalid_email";
  if (!form.password) errors.password = "required";
  return errors;
}

export type RegisterForm = {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  acceptTerms: boolean;
  confirmAge: boolean;
};

export function validateRegister(form: RegisterForm): FieldErrors<keyof RegisterForm> {
  const errors: FieldErrors<keyof RegisterForm> = {};
  if (form.name.trim().length < 2) errors.name = "required";
  if (!form.email.trim()) errors.email = "required";
  else if (!isValidEmail(form.email)) errors.email = "invalid_email";
  if (!form.phone.trim()) errors.phone = "required";
  else if (!normalizeColombianMobile(form.phone)) errors.phone = "invalid_phone";
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
