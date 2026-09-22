import { randomBytes } from 'crypto';
import QRCode from 'qrcode';
import { AppError } from '../utils/error-handler.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_RECENT = 20;

/** @type {Map<string, ScanSession>} */
const sessions = new Map();

/** @typedef {{ id: string, code: string, createdBy: string, createdAt: number, expiresAt: number, scannerJoined: boolean, recentScans: Array<{ code: string, at: string, actorEmail?: string | null }>, subscribers: Set<(payload: object) => void> }} ScanSession */

function purgeExpired() {
  const now = Date.now();
  for (const [code, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(code);
  }
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function getSession(code) {
  purgeExpired();
  const normalized = String(code || '').trim().toUpperCase();
  const session = sessions.get(normalized);
  if (!session) throw new AppError(404, 'Scan session not found or expired', 'SESSION_NOT_FOUND');
  if (session.expiresAt <= Date.now()) {
    sessions.delete(normalized);
    throw new AppError(404, 'Scan session expired', 'SESSION_EXPIRED');
  }
  return session;
}

function broadcast(session, payload) {
  for (const send of session.subscribers) {
    try {
      send(payload);
    } catch {
      session.subscribers.delete(send);
    }
  }
}

export function createScanSession(actor) {
  purgeExpired();
  let code = randomCode();
  for (let i = 0; i < 10 && sessions.has(code); i += 1) {
    code = randomCode();
  }
  const now = Date.now();
  /** @type {ScanSession} */
  const session = {
    id: randomBytes(8).toString('hex'),
    code,
    createdBy: actor?.id ?? 'unknown',
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    scannerJoined: false,
    recentScans: [],
    subscribers: new Set(),
  };
  sessions.set(code, session);
  return {
    code: session.code,
    expiresAt: new Date(session.expiresAt).toISOString(),
    joinPath: `/admin/inventory/scan?relay=${session.code}`,
  };
}

export function joinScanSession(code) {
  const session = getSession(code);
  session.scannerJoined = true;
  broadcast(session, { type: 'scanner_joined', at: new Date().toISOString() });
  return {
    code: session.code,
    expiresAt: new Date(session.expiresAt).toISOString(),
    scannerJoined: true,
  };
}

export function relayScanToSession(code, scanCode, actor) {
  const session = getSession(code);
  const normalized = String(scanCode || '').trim();
  if (!normalized) throw new AppError(400, 'Scan code is required');

  const entry = {
    code: normalized,
    at: new Date().toISOString(),
    actorEmail: actor?.email ?? null,
  };
  session.recentScans.unshift(entry);
  if (session.recentScans.length > MAX_RECENT) {
    session.recentScans.length = MAX_RECENT;
  }

  const payload = { type: 'scan', ...entry };
  broadcast(session, payload);
  return { relayed: true, ...entry };
}

export function getScanSession(code) {
  const session = getSession(code);
  return {
    code: session.code,
    expiresAt: new Date(session.expiresAt).toISOString(),
    scannerJoined: session.scannerJoined,
    recentScans: session.recentScans,
  };
}

export function subscribeScanSession(code, res) {
  const session = getSession(code);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  session.subscribers.add(send);
  send({ type: 'connected', code: session.code, recentScans: session.recentScans });

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  reqOnClose(res, () => {
    clearInterval(heartbeat);
    session.subscribers.delete(send);
  });
}

function reqOnClose(res, fn) {
  res.on('close', fn);
  res.on('finish', fn);
}

export async function renderSessionJoinQr(code, joinUrl) {
  const url = joinUrl || `/admin/inventory/scan?relay=${code}`;
  return QRCode.toBuffer(url, { type: 'png', margin: 1, width: 240 });
}

export const scanRelayService = {
  createScanSession,
  joinScanSession,
  relayScanToSession,
  getScanSession,
  subscribeScanSession,
  renderSessionJoinQr,
};
