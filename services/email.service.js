import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { renderEmailTemplate } from '../utils/email-templates.js';
import { AppError } from '../utils/error-handler.js';

function createTransport() {
  if (!config.mail.host || !config.mail.user || !config.mail.pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: {
      user: config.mail.user,
      pass: config.mail.pass,
    },
  });
}

class EmailService {
  constructor() {
    this.transport = createTransport();
  }

  assertConfigured() {
    if (this.transport) return;
    throw new AppError(
      503,
      'Email service is not configured. Please set SMTP credentials in backend environment variables.',
      'EMAIL_NOT_CONFIGURED'
    );
  }

  async sendTemplate({ to, template, context }) {
    const { subject, html, text } = renderEmailTemplate(template, context);
    this.assertConfigured();

    await this.transport.sendMail({
      from: config.mail.from,
      to,
      subject,
      html,
      text,
    });

    return { queued: true };
  }

  /**
   * Sends a storefront contact form message to the configured admin inbox.
   * @param {{ fromName: string; fromEmail: string; subjectLine: string; message: string }} p
   */
  async sendContactInquiry({ fromName, fromEmail, subjectLine, message }) {
    this.assertConfigured();
    const to = config.contactAdminEmail || config.mail.user;
    if (!to) {
      throw new AppError(
        503,
        'Contact recipient is not configured. Set CONTACT_ADMIN_EMAIL or SMTP_USER.',
        'CONTACT_NOT_CONFIGURED'
      );
    }

    const esc = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const text = `From: ${fromName} <${fromEmail}>\nSubject: ${subjectLine}\n\n${message}`;
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
<p><strong>From:</strong> ${esc(fromName)} &lt;${esc(fromEmail)}&gt;</p>
<p><strong>Subject:</strong> ${esc(subjectLine)}</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0" />
<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${esc(message)}</pre>
</div>`;

    await this.transport.sendMail({
      from: config.mail.from,
      to,
      replyTo: `${fromName} <${fromEmail}>`,
      subject: `[Baby Barn Contact] ${subjectLine}`,
      text,
      html,
    });

    return { sent: true };
  }
}

export const emailService = new EmailService();
