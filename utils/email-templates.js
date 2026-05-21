function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderLayout({ title, preview, bodyHtml }) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const currentYear = new Date().getFullYear();
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;color:#1f2937;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;">
    <div style="display:none;opacity:0;overflow:hidden;height:0;width:0;">${escapeHtml(preview)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:20px 0;background:#ffffff;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:30px 20px 12px;">
                <div style="display:inline-block;background:#d9efde;border-radius:14px;padding:18px 30px;">
                  <div style="font-size:30px;font-weight:800;color:#1e3a2d;letter-spacing:0.6px;line-height:1;">Baby Barn</div>
                  <div style="font-size:11px;color:#365746;margin-top:6px;letter-spacing:0.3px;">Family essentials with care</div>
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 24px 10px;color:#8d8d8d;font-size:12px;line-height:18px;">${escapeHtml(currentDate)}</td>
            </tr>
            <tr>
              <td style="padding:0 24px 26px;font-size:15px;line-height:24px;color:#222222;">${bodyHtml}</td>
            </tr>
            <tr>
              <td style="background:#f8f8f8;border-top:1px solid #ececec;padding:16px 18px;font-size:12px;color:#666666;line-height:18px;text-align:center;">
                <div style="font-weight:700;color:#111111;margin-bottom:6px;">Baby Barn customer communications</div>
                <div>This is an automated message from Baby Barn. Please do not reply directly to this email.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 18px 20px;text-align:center;font-size:12px;color:#a6a6a6;line-height:18px;">
                Copyright ${currentYear} Baby Barn. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function linkButton(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;text-decoration:none;background:#2f6d4d;color:#ffffff;font-weight:700;font-size:14px;line-height:44px;height:44px;padding:0 26px;border-radius:22px;border:0;">${escapeHtml(label)}</a>`;
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

  if (template === 'order-tracking') {
    const subject = 'Your Baby Barn order has shipped';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your order <strong>${escapeHtml(context.orderId || '')}</strong> is on its way.</p>
      <p><strong>${escapeHtml(context.carrier || 'UPS')}</strong> tracking: <strong>${escapeHtml(context.trackingNumber || '')}</strong></p>
      <p>${linkButton(context.actionUrl, 'Track your order')}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Tracking number inside', bodyHtml });
    const text = `Order ${context.orderId} shipped. ${context.carrier} ${context.trackingNumber}. ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'order-confirmation') {
    const subject = 'Your Baby Barn order is confirmed';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your order <strong>${escapeHtml(context.orderId || '')}</strong> is confirmed.</p>
      <p>Total paid: <strong>${escapeHtml(context.total || '')}</strong></p>
      <p>${linkButton(context.actionUrl, 'View your order')}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Order confirmation', bodyHtml });
    const text = `Order ${context.orderId} confirmed. Total ${context.total}. View: ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'return-status') {
    const subject = 'Update on your return request';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your return request status is now <strong>${escapeHtml(context.status || '')}</strong>.</p>
      <p>${linkButton(context.actionUrl, 'View return details')}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Return status update', bodyHtml });
    const text = `Return status updated to ${context.status}. View: ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'store-credit-update') {
    const subject = 'Store credit update';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your store credit was updated by <strong>${escapeHtml(context.amount || '')}</strong>.</p>
      <p>${linkButton(context.actionUrl, 'Open Wallet')}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Store credit update', bodyHtml });
    const text = `Store credit updated by ${context.amount}. View: ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'access-purchase') {
    const subject = 'Your ACCESS membership is active';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Thank you for joining Baby Barn ACCESS. Your member number is <strong>${escapeHtml(context.accessNumber || '')}</strong>.</p>
      <p>Amount paid: <strong>${escapeHtml(context.amount || '')}</strong></p>
      <p>Valid through: <strong>${escapeHtml(context.validUntil || '')}</strong></p>
      <p>${linkButton(context.actionUrl, 'View membership')}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'ACCESS membership confirmed', bodyHtml });
    const text = `ACCESS active. Member ${context.accessNumber}. Valid until ${context.validUntil}. ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'access-renewal') {
    const subject = 'Your ACCESS membership has been renewed';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your ACCESS membership (${escapeHtml(context.accessNumber || '')}) has been renewed.</p>
      <p>Amount paid: <strong>${escapeHtml(context.amount || '')}</strong></p>
      <p>New expiry: <strong>${escapeHtml(context.validUntil || '')}</strong></p>
      <p>${linkButton(context.actionUrl, 'View membership')}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'ACCESS renewed', bodyHtml });
    const text = `ACCESS renewed until ${context.validUntil}. ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'access-renewal-reminder') {
    const subject = 'Your ACCESS membership renews soon';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your ACCESS membership (${escapeHtml(context.accessNumber || '')}) expires on <strong>${escapeHtml(context.validUntil || '')}</strong>.</p>
      <p>Renew now to keep member pricing, returns, and refurbished access without interruption.</p>
      <p>${linkButton(context.actionUrl, 'Renew ACCESS')}</p>
      <p style="font-size:12px;color:#6b7280;">ACCESS is an annual one-time payment — not a recurring subscription.</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Renew ACCESS before it expires', bodyHtml });
    const text = `ACCESS expires ${context.validUntil}. Renew: ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'access-expired') {
    const subject = 'Your ACCESS membership has expired';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your ACCESS membership expired on <strong>${escapeHtml(context.validUntil || '')}</strong>.</p>
      <p>Reactivate anytime to restore member pricing and benefits.</p>
      <p>${linkButton(context.actionUrl, 'Reactivate ACCESS')}</p>
    `;
    const html = renderLayout({ title: subject, preview: 'ACCESS expired', bodyHtml });
    const text = `ACCESS expired. Reactivate: ${context.actionUrl}`;
    return { subject, html, text };
  }

  if (template === 'team-invite') {
    const subject = 'Your Baby Barn team account';
    const bodyHtml = `
      <p>Hi ${escapeHtml(context.name || 'there')},</p>
      <p>Your team account has been created with the role title <strong>${escapeHtml(context.roleTitle || 'Team Member')}</strong>.</p>
      <p>Sign in with:</p>
      <p><strong>Email:</strong> ${escapeHtml(context.email || '')}<br /><strong>Temporary password:</strong> ${escapeHtml(context.temporaryPassword || '')}</p>
      ${
        context.loginUrl
          ? `<p>${linkButton(context.loginUrl, 'Login to Admin Console')}</p><p style="font-size:12px;color:#6b7280;">If the button does not work, use this link:<br />${escapeHtml(context.loginUrl)}</p>`
          : ''
      }
      <p>Please change your password after first login.</p>
    `;
    const html = renderLayout({ title: subject, preview: 'Team account credentials', bodyHtml });
    const text = `Team account created. Email: ${context.email}. Temporary password: ${context.temporaryPassword}`;
    return { subject, html, text };
  }

  throw new Error(`Unsupported email template: ${template}`);
}
