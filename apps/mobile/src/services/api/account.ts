import * as SecureStore from "expo-secure-store";

import { BackendError } from "../backendTypes";

import { ME_KEY, TOKENS_KEY } from "../sessionKeys";
import { readJSON } from "../storage";

import { ApiBase } from "./base";
import { RESEND_COOLDOWN_S, type Tokens, type ApiMe, type ApiSession } from "./shared";

/** Cliente de la API: sesión, registro, verificación del correo y contraseña. */
export abstract class ApiAccount extends ApiBase {
  // --- Cuenta ----------------------------------------------------------------------------

  async login(identifier: string, password: string): Promise<{ needsVerification: boolean }> {
    const session = await this.request<ApiSession>("POST", "/v1/auth/login", { identifier, password });
    await this.startSession(session);
    if (session.needsVerification) this.codeSentAt = Date.now();
    return { needsVerification: session.needsVerification };
  }

  async register(input: { name: string; email: string; username: string; password: string }): Promise<void> {
    const session = await this.request<ApiSession>("POST", "/v1/auth/register", {
      ...input,
      lang: "es",
      acceptTerms: true,
      confirmAge: true,
    });
    this.codeSentAt = Date.now();
    await this.startSession(session);
  }

  async sendVerificationCode(): Promise<void> {
    if (this.secondsUntilResend() > 0) return;
    await this.resendCode();
  }

  secondsUntilResend(): number {
    return Math.max(0, RESEND_COOLDOWN_S - (Date.now() - this.codeSentAt) / 1000);
  }

  async resendCode(): Promise<void> {
    await this.request("POST", "/v1/auth/email/resend");
    this.codeSentAt = Date.now();
  }

  async verifyCode(code: string): Promise<void> {
    const me = await this.request<ApiMe>("POST", "/v1/auth/email/verify", { code });
    this.applyMe(me);
  }

  async logout(): Promise<void> {
    // Primero se da de baja este celular: tras cerrar sesión no debe recibir las alertas de la
    // cuenta (importa en celulares compartidos).
    if (this.tokens && this.pushToken) {
      await this.request("DELETE", "/v1/me/devices", { token: this.pushToken }).catch(() => {});
    }
    if (this.tokens) await this.request("POST", "/v1/auth/logout", { refreshToken: this.tokens.refresh }).catch(() => {});
    this.pushToken = null;
    await this.clearSession();
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.request("POST", "/v1/auth/password-reset", { email });
  }

  /**
   * Restaura la sesión guardada: muestra al instante la última cuenta conocida y la confirma con
   * la API en segundo plano. La sesión sigue abierta hasta que la persona la cierre o la API la
   * rechace; sin red o con la API despertando, se reintenta.
   */
  async restoreSession(_userId: string): Promise<boolean> {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY).catch(() => null);
    if (!raw) return false;
    this.tokens = JSON.parse(raw) as Tokens;
    const cached = await readJSON<ApiMe>(ME_KEY);
    if (cached?.user) this.applyMe(cached);
    void this.confirmSession();
    return true;
  }

  /** Confirma la sesión con la API; reintenta con espera creciente (hasta unos 2 minutos). */
  protected async confirmSession(attempt = 0): Promise<void> {
    try {
      this.applyMe(await this.request<ApiMe>("GET", "/v1/me"));
      await this.sync();
    } catch (e) {
      if (e instanceof BackendError && (e.code === "unauthorized" || e.code === "suspended")) {
        await this.clearSession();
        return;
      }
      if (this.tokens && attempt < 6) {
        setTimeout(() => void this.confirmSession(attempt + 1), Math.min(30_000, 2_000 * 2 ** attempt));
      }
    }
  }
}
