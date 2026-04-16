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
}

export const emailService = new EmailService();
