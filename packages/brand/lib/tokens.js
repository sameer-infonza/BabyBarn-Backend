import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached = null;

/** @returns {import('./tokens.types.js').BrandTokens} */
export function getBrandTokens() {
  if (!cached) {
    const raw = readFileSync(join(__dirname, '..', 'brand.tokens.json'), 'utf8');
    cached = JSON.parse(raw);
  }
  return cached;
}

/** Runtime overrides (URLs, logo) merged into templates. */
export function mergeBrandContext(overrides = {}) {
  const tokens = getBrandTokens();
  return {
    ...tokens,
    urls: {
      store: overrides.storeUrl || 'https://babybarn.co',
      customer: overrides.customerUrl || overrides.storeUrl || 'https://babybarn.co',
      admin: overrides.adminUrl || 'https://admin.babybarn.co',
      logo: overrides.logoUrl || null,
      privacy: `${(overrides.storeUrl || 'https://babybarn.co').replace(/\/$/, '')}${tokens.legal.privacyPath}`,
      terms: `${(overrides.storeUrl || 'https://babybarn.co').replace(/\/$/, '')}${tokens.legal.termsPath}`,
      support: `mailto:${overrides.supportEmail || tokens.contact.supportEmail}`,
    },
    contact: {
      ...tokens.contact,
      supportEmail: overrides.supportEmail || tokens.contact.supportEmail,
    },
  };
}
