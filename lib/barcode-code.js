import { randomBytes } from 'crypto';

/** Crockford base32 (no I, L, O, U) — short, scanner-friendly. */
const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const BARCODE_PREFIX = 'BBP-';
export const BARCODE_CODE_RE = /^BBP-[0-9A-HJKMNP-TV-Z]{8}$/;

export function newBarcodeCode() {
  const bytes = randomBytes(8);
  let body = '';
  for (let i = 0; i < 8; i += 1) {
    body += ALPH[bytes[i] % 32];
  }
  return `${BARCODE_PREFIX}${body}`;
}

export function isBarcodeCode(value) {
  return BARCODE_CODE_RE.test(String(value || '').trim().toUpperCase());
}

export function normalizeBarcodeCode(value) {
  return String(value || '').trim().toUpperCase();
}

/** Unique sellable-line key. Avoids NULL unique issues on productVariantId. */
export function barcodeTargetKey({ productId, variantId }) {
  return variantId ? `v:${variantId}` : `p:${productId}`;
}
