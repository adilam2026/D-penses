import { TestingModuleBuilder } from '@nestjs/testing';
import { MailerService } from '../../src/auth/mailer.service';

/**
 * Remplace le MailerService réel dans les tests e2e : capture le code OTP
 * envoyé pour chaque email au lieu de tenter un vrai envoi SMTP (absent en
 * CI/test). Ne contourne AUCUNE logique métier — seule la frontière externe
 * (l'envoi réel) est substituée, exactement le code généré/haché par
 * AuthService est celui capturé ici.
 */
export class FakeMailer {
  readonly sentCodes = new Map<string, string>();

  async sendOtpEmail(email: string, code: string): Promise<void> {
    this.sentCodes.set(email, code);
  }

  /** Dernier code envoyé pour cet email — lève si signup/resend n'a pas encore été appelé. */
  lastCodeFor(email: string): string {
    const code = this.sentCodes.get(email);
    if (!code) throw new Error(`Aucun code OTP capturé pour ${email} — signup()/resendEmailOtp() a-t-il bien été appelé ?`);
    return code;
  }
}

export function withFakeMailer(mailer: FakeMailer) {
  return (builder: TestingModuleBuilder) => builder.overrideProvider(MailerService).useValue(mailer);
}
