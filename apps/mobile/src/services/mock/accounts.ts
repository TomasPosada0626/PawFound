import type { User } from "@/domain/types";

import { normalizeUsername } from "@/domain/validation";

import { BackendError } from "../backendTypes";

import { MockBase } from "./base";
import { DEMO_CODE, RESEND_COOLDOWN_S, CODE_TTL_MIN, MAX_CODE_ATTEMPTS, LOCK_MINUTES } from "./constants";

/** Modo demostración: sesión, registro y verificación del correo. */
export abstract class MockAccounts extends MockBase {
  // --- Sesión y cuentas -----------------------------------------------------

  get currentUser(): User | null {
    const id = this.state.sessionUserId;
    return id ? (this.state.users[id] ?? null) : null;
  }

  protected requireUser(): User {
    const user = this.currentUser;
    if (!user) throw new BackendError("not_allowed");
    return user;
  }

  /** Acciones de escritura comunitaria exigen teléfono verificado (insignia azul). */
  protected requireVerified(): User {
    const user = this.requireUser();
    if (!user.verified) throw new BackendError("not_allowed");
    return user;
  }

  /** Entra con el correo o con el nombre de usuario. */
  async login(identifier: string, password: string): Promise<{ needsVerification: boolean }> {
    const id = identifier.trim().toLowerCase();
    const username = id.includes("@") ? null : normalizeUsername(id);
    const email = username
      ? Object.values(this.state.users)
          .find((u) => u.username === username)
          ?.email.toLowerCase()
      : id;
    const entry = email ? this.credentials.get(email) : undefined;
    // Mismo error para correo inexistente y contraseña incorrecta: no revela si la cuenta existe.
    if (!entry || entry.password !== password) throw new BackendError("invalid_credentials");
    const user = this.state.users[entry.userId];
    if (!user) throw new BackendError("invalid_credentials");
    this.commit({ sessionUserId: user.id });
    if (!user.verified) {
      this.issueCode(user.id, user.email);
      return { needsVerification: true };
    }
    return { needsVerification: false };
  }

  /** Registro con correo, nombre y apellidos, usuario y contraseña. Envía el código al correo. */
  async register(input: { name: string; email: string; username: string; password: string }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    if (this.credentials.has(email)) throw new BackendError("email_taken");
    const username = normalizeUsername(input.username);
    if (!username) throw new BackendError("invalid_username");
    if (Object.values(this.state.users).some((u) => u.username === username)) throw new BackendError("username_taken");
    const user = this.makeUser({ name: input.name.trim(), email, username });
    this.credentials.set(email, { userId: user.id, password: input.password });
    this.commit({ users: { ...this.state.users, [user.id]: user }, sessionUserId: user.id });
    this.issueCode(user.id, email);
  }

  protected makeUser({ name, email, username: chosen }: { name: string; email: string; username?: string }): User {
    const base =
      email
        .split("@")[0]
        ?.replace(/[^a-z0-9_]/gi, "")
        .toLowerCase() || "pawfriend";
    let username = chosen ?? base.slice(0, 16);
    while (!chosen && Object.values(this.state.users).some((u) => u.username === username)) {
      username = `${base.slice(0, 14)}${Math.floor(Math.random() * 90 + 10)}`;
    }
    return {
      id: this.id("u"),
      name,
      username,
      email,
      verified: false,
      avatar: "dog",
      title: "animal_lover",
      bio: "",
      city: "Medellín",
      createdAt: this.iso(),
      lang: "es",
    };
  }

  /** En demostración el código siempre es DEMO_CODE; la API real lo envía al correo. */
  protected issueCode(userId: string, email: string) {
    this.commit({
      verification: { userId, email, code: DEMO_CODE, sentAt: this.iso(), attempts: 0 },
    });
  }

  /** Envía un código al correo de la cuenta actual (si todavía no está verificada). */
  async sendVerificationCode(): Promise<void> {
    const user = this.requireUser();
    if (!user.verified) this.issueCode(user.id, user.email);
  }

  secondsUntilResend(): number {
    const v = this.state.verification;
    if (!v) return 0;
    const elapsed = (this.now().getTime() - new Date(v.sentAt).getTime()) / 1000;
    return Math.max(0, RESEND_COOLDOWN_S - elapsed);
  }

  async resendCode(): Promise<void> {
    const v = this.state.verification;
    if (!v) throw new BackendError("not_allowed");
    if (this.secondsUntilResend() > 0) throw new BackendError("not_allowed");
    // Se conserva el contador de intentos: reenviar no reinicia el bloqueo.
    this.commit({ verification: { ...v, sentAt: this.iso(), code: DEMO_CODE } });
  }

  async verifyCode(code: string): Promise<void> {
    const v = this.state.verification;
    if (!v) throw new BackendError("not_allowed");
    const now = this.now();
    if (v.lockedUntil && new Date(v.lockedUntil) > now) {
      const minutes = Math.ceil((new Date(v.lockedUntil).getTime() - now.getTime()) / 60_000);
      throw new BackendError("locked", { minutes });
    }
    if (now.getTime() - new Date(v.sentAt).getTime() > CODE_TTL_MIN * 60_000) throw new BackendError("expired");
    if (code !== v.code) {
      const attempts = v.attempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
        this.commit({ verification: { ...v, attempts: 0, lockedUntil } });
        throw new BackendError("locked", { minutes: LOCK_MINUTES });
      }
      this.commit({ verification: { ...v, attempts } });
      throw new BackendError("wrong_code", { count: MAX_CODE_ATTEMPTS - attempts });
    }
    const user = this.state.users[v.userId];
    if (!user) throw new BackendError("not_found");
    // Al verificar el correo se otorga la insignia azul ("Protector verificado").
    this.commit({
      users: { ...this.state.users, [user.id]: { ...user, verified: true } },
      verification: null,
    });
  }

  async logout(): Promise<void> {
    this.commit({ sessionUserId: null, verification: null });
  }

  async requestPasswordReset(_email: string): Promise<void> {
    // Respuesta idéntica exista o no la cuenta (sin enumeración de correos).
  }

  /** Restaura la sesión guardada solo si la cuenta sigue existiendo. */
  async restoreSession(userId: string): Promise<boolean> {
    if (!this.state.users[userId]) return false;
    this.commit({ sessionUserId: userId });
    return true;
  }
}
