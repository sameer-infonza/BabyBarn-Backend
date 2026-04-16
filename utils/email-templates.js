function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderLayout({ title, preview, bodyHtml }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#1f2937;">
    <div style="display:none;opacity:0;overflow:hidden;height:0;width:0;">${escapeHtml(preview)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#fff;border-radius:12px;padding:24px;">
            <tr><td style="font-size:24px;font-weight:700;color:#111827;padding-bottom:8px;">Baby Barn</td></tr>
            <tr><td style="font-size:16px;line-height:1.5;color:#374151;">${bodyHtml}</td></tr>
            <tr><td style="padding-top:20px;font-size:12px;color:#6b7280;">This is an automated message. Please do not reply.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function linkButton(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(label)}</a>`;
}

export function renderEmailTemplate(template, context) {
  if (template === 'verify-email') {
    const subject = 'Verify your Baby Barn account';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Thanks for signing up. Please verify your email to activate your account.</p>
      <p>${linkButton(context.actionUrl, 'Verify Email')}</p>
      <p>If the button does not work, copy and paste this link:</p>
      <p>${escapeHtml(context.actionUrl)}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Verify your email to activate account.', bodyHtml });
    const text = `Hi ${context.name || 'there'}, verify your account: ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'forgot-password') {
    const subject = 'Reset your Baby Barn password';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>We received a request to reset your password.</p>
      <p>${linkButton(context.actionUrl, 'Reset Password')}</p>
      <p>This link will expire in 60 minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Password reset instructions', bodyHtml });
    const text = `Reset your password using this link (expires in 60 minutes): ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'welcome') {
    const subject = 'Welcome to Baby Barn';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your account is now active. Welcome to Baby Barn.</p>
      <p>${linkButton(context.actionUrl, 'Go to Dashboard')}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Welcome to Baby Barn', bodyHtml });
    const text = `Welcome to Baby Barn. Open: ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'otp') {
    const subject = 'Your Baby Barn OTP code';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your one-time verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${escapeHtml(context.otp || '')}</p>
      <p>This code expires in ${escapeHtml(String(context.minutes || 10))} minutes.</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Your OTP verification code', bodyHtml });
    const text = `Your OTP is ${context.otp}. It expires in ${context.minutes || 10} minutes.`;
    return { subject, html, text };
  }

  throw new Error(`Unsupported email template: ${template}`);
}
