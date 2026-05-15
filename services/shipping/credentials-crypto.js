import crypto from 'crypto';

function getKey() {
  const raw = String(process.env.SHIPPING_CREDENTIALS_MASTER_KEY || '').trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    return null;
  }
  const h = crypto.createHash('sha256').update(raw).digest();
  return h;
}

export function encryptCredentialsJson(obj) {
  const key = getKey();
  if (!key) {
    throw new Error('SHIPPING_CREDENTIALS_MASTER_KEY is not set (32-byte base64)');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = JSON.stringify(obj);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([iv, tag, enc]).toString('base64');
  return out;
}

export function decryptCredentialsJson(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  const key = getKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(dec);
  } catch {
    return null;
  }
}

export function hasMasterKey() {
  return Boolean(getKey());
}
