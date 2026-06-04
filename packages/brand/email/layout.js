import { escapeHtml } from '../lib/escape.js';
import { getBrandTokens } from '../lib/tokens.js';
import { emailFooter, emailHeader } from './components.js';

/**
 * Full responsive HTML email document shell.
 * @param {{ title: string; preview: string; bodyHtml: string; brand?: object }} opts
 */
export function renderEmailDocument({ title, preview, bodyHtml, brand }) {
  const tokens = getBrandTokens();
  const c = tokens.colors;
  const maxW = tokens.spacing.emailMaxWidth;
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(title)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .bb-shell { width: 100% !important; }
        .bb-pad { padding-left: 16px !important; padding-right: 16px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${c.cream};font-family:${tokens.typography.emailFontStack};color:${c.ink};-webkit-text-size-adjust:none;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${c.cream};padding:24px 12px;">
      <tr>
        <td align="center">
          <table class="bb-shell" width="${maxW}" cellpadding="0" cellspacing="0" role="presentation" style="max-width:${maxW}px;width:100%;background:${c.white};border:1px solid ${c.border};border-radius:${tokens.spacing.emailRadius}px;overflow:hidden;box-shadow:0 4px 24px rgba(26,15,53,0.06);">
            <tr><td>${emailHeader(brand)}</td></tr>
            <tr>
              <td class="bb-pad" align="center" style="padding:0 28px 6px;color:${c.inkMuted};font-size:12px;line-height:18px;">${escapeHtml(dateStr)}</td>
            </tr>
            <tr>
              <td class="bb-pad" style="padding:4px 28px 28px;font-size:15px;line-height:24px;color:${c.emailBody};">${bodyHtml}</td>
            </tr>
            <tr><td>${emailFooter(brand)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
