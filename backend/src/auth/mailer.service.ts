import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Envoi du code de vérification email (§5 de la demande : uniquement un code
 * à 6 chiffres, jamais de lien cliquable). Envoi via l'API HTTPS de Resend
 * (RESEND_API_KEY / EMAIL_FROM) plutôt que du SMTP direct : Railway, sur son
 * plan actuel, bloque le SMTP sortant (confirmé — timeout de connexion sur
 * smtp.gmail.com:587). Tant que RESEND_API_KEY n'est pas renseigné (dev
 * local, CI, tests), le code est journalisé au lieu d'être envoyé.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtpEmail(email: string, code: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn(`RESEND_API_KEY non configuré — code OTP pour ${email} (journalisé, non envoyé) : ${code}`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.get('EMAIL_FROM', 'onboarding@resend.dev'),
        to: email,
        subject: 'Votre code de vérification',
        text: `Bonjour,\n\nVotre code de vérification est : ${code}\n\nSaisissez ce code dans l'application pour confirmer votre adresse email. Ce code expire dans 15 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.`,
        html: `<p>Bonjour,</p><p>Votre code de vérification est :</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>Saisissez ce code dans l'application pour confirmer votre adresse email. Ce code expire dans 15 minutes.</p><p>Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p>`,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Échec envoi email Resend (HTTP ${res.status}): ${body}`);
    }
  }
}
