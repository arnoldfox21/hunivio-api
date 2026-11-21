import { Injectable, Logger, Optional } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { KeylokaEmailInput, renderKeylokaEmail } from './mail-templates';
import { PlatformService } from '../platform/platform.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: 'smtp' | 'resend' | 'log';
  private readonly fromAddress: string;
  private readonly frontendUrl: string;
  private readonly resendApiKey: string;
  private smtpTransporter: Transporter | null = null;

  constructor(@Optional() private readonly platformService?: PlatformService) {
    const rawProvider = (process.env.MAIL_PROVIDER || '').trim().toLowerCase();
    this.fromAddress =
      process.env.MAIL_FROM?.trim() || 'Keyloka <no-reply@keyloka.com>';
    this.frontendUrl = (
      process.env.FRONTEND_URL?.trim() || 'https://keyloka.com'
    ).replace(/\/+$/, '');
    this.resendApiKey = process.env.RESEND_API_KEY?.trim() || '';

    const smtpHost = process.env.SMTP_HOST?.trim() || '';
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpUser = process.env.SMTP_USER?.trim() || '';
    const smtpPass = process.env.SMTP_PASS?.trim() || '';
    const smtpSecure =
      process.env.SMTP_SECURE !== undefined
        ? process.env.SMTP_SECURE === 'true'
        : smtpPort === 465;

    if (rawProvider === 'resend' && this.resendApiKey) {
      this.provider = 'resend';
    } else if (
      (rawProvider === 'smtp' || (!rawProvider && smtpHost && smtpUser && smtpPass)) &&
      smtpHost &&
      smtpUser &&
      smtpPass
    ) {
      this.provider = 'smtp';
      this.smtpTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    } else if (!rawProvider && this.resendApiKey) {
      this.provider = 'resend';
    } else {
      this.provider = 'log';
      this.logger.warn(
        'MAIL_PROVIDER belum dikonfigurasi (SMTP/Resend). Email akan dicatat ke log server saja.',
      );
    }
  }

  buildFrontendUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.frontendUrl}${cleanPath}`;
  }

  async sendEmail(to: string | null | undefined, input: KeylokaEmailInput): Promise<void> {
    const recipient = (to || '').trim();
    if (!recipient || !recipient.includes('@')) return;

    const rendered = renderKeylokaEmail({
      ...input,
      frontendUrl: this.frontendUrl,
      ctaUrl: input.ctaUrl
        ? /^https?:\/\//i.test(input.ctaUrl)
          ? input.ctaUrl
          : this.buildFrontendUrl(input.ctaUrl)
        : undefined,
    });

    try {
      if (this.provider === 'log') {
        this.logger.log(`[MAIL:LOG] to=${recipient} subject="${rendered.subject}"`);
        return;
      }

      if (this.provider === 'resend') {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: this.fromAddress,
            to: [recipient],
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          this.logger.warn(
            `Gagal mengirim email Resend ke ${recipient} (${res.status}): ${errText}`,
          );
          void this.platformService?.recordEvent({
            level: 'ERROR',
            category: 'MAIL',
            message: `Gagal mengirim email Resend ke ${recipient} (${res.status})`,
            meta: { subject: rendered.subject, status: res.status },
          });
          return;
        }
        this.logger.log(
          `Email Resend terkirim ke ${recipient} (${rendered.subject})`,
        );
        return;
      }

      if (this.provider === 'smtp' && this.smtpTransporter) {
        const info = await this.smtpTransporter.sendMail({
          from: this.fromAddress,
          to: recipient,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        this.logger.log(
          `Email SMTP terkirim ke ${recipient} (${rendered.subject}) messageId=${info.messageId}`,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Gagal mengirim email ke ${recipient} (${rendered.subject}): ${errMsg}`,
      );
      void this.platformService?.recordEvent({
        level: 'ERROR',
        category: 'MAIL',
        message: `Gagal mengirim email ke ${recipient}: ${errMsg}`,
        meta: { subject: rendered.subject, provider: this.provider },
      });
    }
  }
}
