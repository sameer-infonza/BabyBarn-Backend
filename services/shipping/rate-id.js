const PREFIX = 'bb:';

export function encodeShippoRateId(objectId) {
  const id = String(objectId || '').trim();
  if (!id) return '';
  if (id.startsWith(PREFIX)) return id;
  return `${PREFIX}shippo:${encodeURIComponent(id)}`;
}

export function decodeShippoRateId(rateId) {
  const raw = String(rateId || '').trim();
  if (!raw) return null;
  if (raw.startsWith(`${PREFIX}shippo:`)) {
    return decodeURIComponent(raw.slice(`${PREFIX}shippo:`.length));
  }
  return raw;
}

export function encodeUpsRateId(payload) {
  const json = JSON.stringify({ v: 1, ...payload });
  const b = Buffer.from(json, 'utf8').toString('base64url');
  return `${PREFIX}ups:${b}`;
}

export function decodeUpsRateId(rateId) {
  const raw = String(rateId || '').trim();
  if (!raw.startsWith(`${PREFIX}ups:`)) return null;
  const b = raw.slice(`${PREFIX}ups:`.length);
  try {
    const json = Buffer.from(b, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function encodeDemoRateId(payload) {
  const json = JSON.stringify({ v: 1, ...payload });
  const b = Buffer.from(json, 'utf8').toString('base64url');
  return `${PREFIX}demo:${b}`;
}

export function decodeDemoRateId(rateId) {
  const raw = String(rateId || '').trim();
  if (!raw.startsWith(`${PREFIX}demo:`)) return null;
  const b = raw.slice(`${PREFIX}demo:`.length);
  try {
    const json = Buffer.from(b, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function parseRateId(rateId) {
  const raw = String(rateId || '').trim();
  if (!raw) return { kind: 'empty' };
  if (raw.startsWith(`${PREFIX}shippo:`)) {
    return { kind: 'legacy_middleware', provider: 'shippo', objectId: decodeShippoRateId(raw) };
  }
  if (raw.startsWith(`${PREFIX}ups:`)) {
    return { kind: 'ups', payload: decodeUpsRateId(raw) };
  }
  if (raw.startsWith(`${PREFIX}demo:`)) {
    return { kind: 'demo', payload: decodeDemoRateId(raw) };
  }
  return { kind: 'legacy_middleware', provider: 'unknown', raw };
}
