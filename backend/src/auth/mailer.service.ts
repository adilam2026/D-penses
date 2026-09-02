import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Envoi du code de vérification email (§5 de la demande : uniquement un code
 * à 6 chiffres, jamais de lien cliquable). Configuré via SMTP_HOST/SMTP_PORT/
 * SMTP_USER/SMTP_PASSWORD/SMTP_FROM — noms uniquement, aucune valeur fabriquée
 * ici. Tant que SMTP_HOST n'est pas renseigné (dev local, CI, tests), le code
 * est journalisé au lieu d'être envoyé : permet de développer/tester le
 * parcours sans dépendre d'un fournisseur email réel, jamais une fausse
 * confirmation silencieuse d'envoi.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtpEmail(email: string, code: string): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn(`SMTP_HOST non configuré — code OTP pour ${email} (journalisé, non envoyé) : ${code}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(this.config.get('SMTP_PORT', '587')),
      secure: this.config.get('SMTP_PORT') === '465',
      auth: {
        user: this.config.getOrThrow<string>('SMTP_USER'),
        pass: this.config.getOrThrow<string>('SMTP_PASSWORD'),
      },
    });

    await transporter.sendMail({
      from: this.config.get('SMTP_FROM', this.config.getOrThrow<string>('SMTP_USER')),
      to: email,
      subject: 'Votre code de vérification',
      text: `Bonjour,\n\nVotre code de vérification est : ${code}\n\nSaisissez ce code dans l'application pour confirmer votre adresse email. Ce code expire dans 15 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.`,
      html: `<p>Bonjour,</p><p>Votre code de vérification est :</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>Saisissez ce code dans l'application pour confirmer votre adresse email. Ce code expire dans 15 minutes.</p><p>Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p>`,
    });
  }
}
