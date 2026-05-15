import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { AppError } from '../../../utils/error-handler.js';
import { UpsClient } from '../../providers/ups.client.js';
import { encodeUpsRateId } from '../rate-id.js';
import {
  toShippoAddress,
  defaultFromAddress,
  hasCompleteAddress,
  sanitizeParcel,
  defaultParcel,
} from '../shipping-address.js';
import { decryptCredentialsJson } from '../credentials-crypto.js';
import { SHIPPING_LABELS_DIR } from '../../../utils/product-upload.js';

function mergeUpsCredentials(providerRow) {
  const fromDb =
    providerRow?.credentialsEncrypted && decryptCredentialsJson(providerRow.credentialsEncrypted);
  const fromEnv = {
    clientId: process.env.UPS_CLIENT_ID || '',
    clientSecret: process.env.UPS_CLIENT_SECRET || '',
    accountNumber: process.env.UPS_ACCOUNT_NUMBER || '',
    baseUrl: process.env.UPS_API_BASE_URL || '',
  };
  const merged = {
    clientId: String(fromDb?.clientId || fromEnv.clientId || '').trim(),
    clientSecret: String(fromDb?.clientSecret || fromEnv.clientSecret || '').trim(),
    accountNumber: String(fromDb?.accountNumber || fromEnv.accountNumber || '').trim(),
    baseUrl: String(fromDb?.baseUrl || fromEnv.baseUrl || '').trim() || undefined,
  };
  return merged;
}

export async function upsGetRates(providerRow, payload, allowedServiceCodes) {
  const fromAddr = toShippoAddress(payload.fromAddress || defaultFromAddress());
  const toAddr = toShippoAddress(payload.shippingAddress || payload.toAddress || {});
  const parcels = Array.isArray(payload.parcels) && payload.parcels.length > 0
    ? payload.parcels.map(sanitizeParcel)
    : [defaultParcel()];
  const parcel = parcels[0];

  if (!hasCompleteAddress(toAddr) || !hasCompleteAddress(fromAddr)) {
    return { error: 'incomplete_address', rates: [] };
  }

  const creds = mergeUpsCredentials(providerRow);
  const client = new UpsClient(creds);
  if (!client.hasCredentials()) {
    return { error: 'not_configured', rates: [] };
  }

  const data = await client.shopRate({ from: fromAddr, to: toAddr, parcel });
  const parsed = UpsClient.parseShopRates(data);
  const allow = new Set((allowedServiceCodes || []).map((c) => String(c)));
  const passAll = allow.has('*');
  const filtered = passAll
    ? parsed
    : parsed.filter((r) => allow.has(String(r.serviceCode)));

  const rates = filtered
    .map((r) => ({
      rateId: encodeUpsRateId({ s: r.serviceCode, a: r.totalCharges, c: r.currency }),
      provider: 'UPS',
      serviceLevel: r.serviceName,
      serviceToken: r.serviceCode,
      currency: r.currency,
      amount: r.totalCharges,
      estimatedDays: r.guaranteedDaysToDelivery ?? null,
      attributes: [],
      durationTerms: null,
      providerSlug: 'ups',
      externalRateId: r.serviceCode,
    }))
    .sort((a, b) => Number(a.amount) - Number(b.amount));

  return {
    shipmentId: null,
    rates,
    diagnostics: { provider: 'ups', rawRatedCount: parsed.length, filteredCount: rates.length },
  };
}

export async function upsBuyLabel(providerRow, payload) {
  const { decodeUpsRateId } = await import('../rate-id.js');
  const decoded = decodeUpsRateId(String(payload.rateId || '').trim());
  if (!decoded || !decoded.s) {
    throw new AppError(400, 'Invalid UPS rate id', 'UPS_RATE_INVALID');
  }
  const fromAddr = toShippoAddress(payload.fromAddress || defaultFromAddress());
  const toAddr = toShippoAddress(payload.shippingAddress || payload.toAddress || {});
  const parcels = Array.isArray(payload.parcels) && payload.parcels.length > 0
    ? payload.parcels.map(sanitizeParcel)
    : [defaultParcel()];
  const parcel = parcels[0];
  if (!hasCompleteAddress(toAddr) || !hasCompleteAddress(fromAddr)) {
    throw new AppError(400, 'Incomplete shipping addresses for UPS label', 'SHIPPING_ADDRESS_INVALID');
  }

  const creds = mergeUpsCredentials(providerRow);
  const client = new UpsClient(creds);
  if (!client.hasCredentials()) {
    throw new AppError(503, 'UPS is not configured', 'UPS_NOT_CONFIGURED');
  }

  fs.mkdirSync(SHIPPING_LABELS_DIR, { recursive: true });
  const data = await client.ship({
    from: fromAddr,
    to: toAddr,
    parcel,
    serviceCode: String(decoded.s),
    description: payload.description || 'Baby Barn order',
  });
  const parsed = UpsClient.parseShipResponse(data);
  if (!parsed.graphicImageBase64) {
    throw new AppError(502, 'UPS did not return a label image', 'UPS_LABEL_EMPTY', {
      hint: 'Check Ship API response for errors',
    });
  }
  const buf = Buffer.from(parsed.graphicImageBase64, 'base64');
  const fname = `ups-${Date.now()}-${randomBytes(4).toString('hex')}.gif`;
  const abs = path.join(SHIPPING_LABELS_DIR, fname);
  fs.writeFileSync(abs, buf);
  const shippingLabelUrl = `/uploads/shipping-labels/${fname}`;

  return {
    provider: 'UPS',
    transactionId: parsed.shipmentDigest || parsed.identificationNumber || null,
    status: 'SUCCESS',
    trackingNumber: parsed.trackingNumber,
    shippingCarrier: 'UPS',
    shippingLabelUrl,
    qrCodeUrl: null,
    messages: [],
    raw: { ups: true },
  };
}

export async function upsTrack(trackingNumber, providerRow) {
  const tn = String(trackingNumber || '').trim();
  if (!tn) {
    throw new AppError(400, 'trackingNumber is required', 'TRACKING_INVALID');
  }
  const creds = mergeUpsCredentials(providerRow);
  const client = new UpsClient(creds);
  if (!client.hasCredentials()) {
    throw new AppError(503, 'UPS is not configured', 'UPS_NOT_CONFIGURED');
  }
  const data = await client.trackDetails(tn);
  const p = UpsClient.parseTrackResponse(data);
  return {
    carrier: 'UPS',
    trackingNumber: tn,
    status: p.status,
    statusDetails: p.statusDetails,
    statusDate: p.statusDate,
    eta: p.eta,
    history: p.history,
    addressFrom: null,
    addressTo: null,
    raw: p.raw,
  };
}
