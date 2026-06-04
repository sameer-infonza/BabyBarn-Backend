import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { renderBrandedEmailTemplate } from '@babybarn/brand';
import { getBrandContext } from '../lib/brand-context.js';
import { AppError } from '../utils/error-handler.js';

/** @typedef {'sendgrid' | 'smtp'} MailProvider */

/**
 * Parse "Name <email@domain.com>" or plain email into SendGrid / nodemailer shape.
 * @param {string} value
 * @returns {{ email: string; name?: string }}
 */
export function parseMailAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return { email: '' };

  const named = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (named) {
    return { name: named[1].trim(), email: named[2].trim() };
  }
  return { email: raw };
}

function createSmtpTransport() {
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

/** @returns {MailProvider | null} */
function resolveMailProvider() {
  const hasSendgrid = Boolean(config.mail.sendgridApiKey);
  const hasSmtp = Boolean(config.mail.host && config.mail.user && config.mail.pass);
  const mode = config.mail.provider || 'auto';

  if (mode === 'smtp') return hasSmtp ? 'smtp' : null;
  if (mode === 'sendgrid') return hasSendgrid ? 'sendgrid' : null;

  // auto: in development prefer SMTP when both are configured (avoids stale SendGrid keys locally)
  if (config.nodeEnv !== 'production' && hasSmtp && hasSendgrid) return 'smtp';
  if (hasSendgrid) return 'sendgrid';
  if (hasSmtp) return 'smtp';
  return null;
}

class EmailService {
  constructor() {
    this.provider = resolveMailProvider();
    this.smtpTransport = this.provider === 'smtp' ? createSmtpTransport() : null;

    if (this.provider === 'sendgrid') {
      sgMail.setApiKey(config.mail.sendgridApiKey);
      console.info('[email] Provider: SendGrid');
    } else if (this.provider === 'smtp') {
      console.info(`[email] Provider: SMTP (${config.mail.host}:${config.mail.port})`);
    } else {
      console.warn('[email] No mail provider configured (set SENDGRID_API_KEY or SMTP_*)');
    }
  }

  assertConfigured() {
    if (this.provider) return;
    throw new AppError(
      503,
      'Email service is not configured. Set SENDGRID_API_KEY or SMTP credentials in backend environment variables.',
      'EMAIL_NOT_CONFIGURED'
    );
  }

  /**
   * @param {{ to: string; subject: string; html: string; text: string; replyTo?: string }} payload
   */
  async sendMessage({ to, subject, html, text, replyTo }) {
    this.assertConfigured();

    const from = parseMailAddress(config.mail.from);
    if (!from.email) {
      throw new AppError(503, 'MAIL_FROM is not configured.', 'EMAIL_NOT_CONFIGURED');
    }

    try {
      if (this.provider === 'sendgrid') {
        /** @type {import('@sendgrid/mail').MailDataRequired} */
        const msg = {
          to,
          from,
          subject,
          html,
          text,
        };
        if (replyTo) {
          msg.replyTo = parseMailAddress(replyTo);
        }
        await sgMail.send(msg);
        return { sent: true, provider: 'sendgrid' };
      }

      // Gmail SMTP: From must match the authenticated mailbox (or an allowed alias).
      const smtpFrom =
        config.mail.smtpFrom ||
        (config.mail.user.includes('@') ? `Baby Barn <${config.mail.user}>` : config.mail.from);

      await this.smtpTransport.sendMail({
        from: smtpFrom,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
      });
      return { sent: true, provider: 'smtp' };
    } catch (err) {
      const detail =
        err?.response?.body?.errors?.map((e) => e.message).join('; ') ||
        err?.message ||
        'Unknown email error';
      console.error(`[email] send failed (${this.provider})`, detail);
      throw new AppError(502, 'Unable to send email right now. Please try again later.', 'EMAIL_DELIVERY_FAILED');
    }
  }

  async sendTemplate({ to, template, context }) {
    const brand = getBrandContext();
    const { subject, html, text } = renderBrandedEmailTemplate(template, context, brand);
    await this.sendMessage({ to, subject, html, text });
    return { queued: true };
  }

  /**
   * Sends a storefront contact form message to the configured admin inbox.
   * @param {{ fromName: string; fromEmail: string; subjectLine: string; message: string }} p
   */
  async sendContactInquiry({ fromName, fromEmail, subjectLine, message }) {
    const to =
      config.contactAdminEmail ||
      config.mail.user ||
      (this.provider === 'sendgrid' ? parseMailAddress(config.mail.from).email : '');
    if (!to) {
      throw new AppError(
        503,
        'Contact recipient is not configured. Set CONTACT_ADMIN_EMAIL or SMTP_USER.',
        'CONTACT_NOT_CONFIGURED'
      );
    }

    const text = `From: ${fromName} <${fromEmail}>\nSubject: ${subjectLine}\n\n${message}`;
    const brand = getBrandContext();
    const { subject, html } = renderBrandedEmailTemplate(
      'contact-inquiry-admin',
      {
        fromName,
        fromEmail,
        subjectLine,
        message,
        plainText: text,
      },
      brand
    );

    await this.sendMessage({
      to,
      replyTo: `${fromName} <${fromEmail}>`,
      subject,
      text,
      html,
    });

    return { sent: true };
  }
}

export const emailService = new EmailService();
