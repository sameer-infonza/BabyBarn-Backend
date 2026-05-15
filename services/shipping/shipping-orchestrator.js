import { AppError } from '../../utils/error-handler.js';
import {
  loadShippingConfig,
  getDefaultProviderSlug,
  getEnabledServiceCodes,
  appendShippingLog,
} from './shipping-config.service.js';
import * as upsProv from './providers/ups-shipping.provider.js';
import { parseRateId } from './rate-id.js';

function fallbackQuote(address) {
  if (!address || !String(address.country || '').trim()) {
    return {
      cost: 0,
      zone: 'unknown',
      description: 'Select country and region to see estimated shipping.',
      provider: 'fallback',
    };
  }
  const country = String(address.country || '').toUpperCase();
  if (country && country !== 'US' && country !== 'USA' && country !== 'UNITED STATES') {
    return {
      cost: 24.99,
      zone: 'international',
      description: 'International standard delivery (estimated 7–14 business days).',
      provider: 'fallback',
    };
  }
  const state = String(address.state || '').toUpperCase();
  if (state === 'AK' || state === 'HI') {
    return {
      cost: 14.99,
      zone: 'us_non_contiguous',
      description: 'U.S. non-contiguous (Alaska / Hawaii) ground rate.',
      provider: 'fallback',
    };
  }
  if (!state) {
    return {
      cost: 0,
      zone: 'unknown',
      description: 'Enter state / province to finalize domestic shipping.',
      provider: 'fallback',
    };
  }
  return {
    cost: 7.99,
    zone: 'us_domestic',
    description: 'Contiguous U.S. ground delivery (estimated 3–5 business days).',
    provider: 'fallback',
  };
}

function fallbackRateFromQuote(quote) {
  return {
    rateId: null,
    provider: quote.provider || 'fallback',
    serviceLevel: 'Standard',
    serviceToken: null,
    currency: 'USD',
    amount: Number(quote.cost || 0),
    estimatedDays: null,
    attributes: [],
    durationTerms: quote.description || null,
  };
}

export async function orchestratorGetRates(payload = {}) {
  const surface = payload.surface === 'checkout' ? 'checkout' : 'admin';
  const { providers } = await loadShippingConfig();

  let slug =
    surface === 'checkout'
      ? await getDefaultProviderSlug()
      : String(payload.providerSlug || '').trim() || (await getDefaultProviderSlug());

  const providerRow = providers.find((p) => p.slug === slug && p.enabled);
  const effectiveSlug = providerRow ? slug : (await getDefaultProviderSlug());
  const row = providers.find((p) => p.slug === effectiveSlug && p.enabled) || providers.find((p) => p.enabled);

  if (!row || row.slug !== 'ups') {
    const fb = fallbackQuote(payload.shippingAddress || payload.toAddress || {});
    if (payload.preferProviderOnly) {
      throw new AppError(503, 'UPS is the only configured carrier; enable UPS in admin shipping.', 'UPS_REQUIRED');
    }
    return { provider: fb.provider, shipmentId: null, rates: [fallbackRateFromQuote(fb)] };
  }

  const methods = await getEnabledServiceCodes(row.id, surface);
  const codes = methods.map((m) => String(m.code));

  try {
    const envOff = String(process.env.SHIPPING_UPS_ENABLED || '').toLowerCase() === 'false';
    if (envOff) {
      if (payload.preferProviderOnly) {
        throw new AppError(503, 'UPS is disabled by configuration', 'UPS_DISABLED');
      }
      const fb = fallbackQuote(payload.shippingAddress || payload.toAddress || {});
      return { provider: fb.provider, shipmentId: null, rates: [fallbackRateFromQuote(fb)] };
    }
    const res = await upsProv.upsGetRates(row, payload, codes);
    if (res.error === 'incomplete_address') {
      if (payload.preferProviderOnly) {
        throw new AppError(400, 'Incomplete shipping address', 'SHIPPING_ADDRESS_INVALID');
      }
      const fb = fallbackQuote(payload.shippingAddress || payload.toAddress || {});
      return { provider: fb.provider, shipmentId: null, rates: [fallbackRateFromQuote(fb)] };
    }
    if (res.error === 'not_configured') {
      if (payload.preferProviderOnly) {
        throw new AppError(503, 'UPS is not configured', 'UPS_NOT_CONFIGURED');
      }
      const fb = fallbackQuote(payload.shippingAddress || payload.toAddress || {});
      return { provider: fb.provider, shipmentId: null, rates: [fallbackRateFromQuote(fb)] };
    }
    const upsRates = res.rates || [];
    await appendShippingLog({
      providerSlug: 'ups',
      action: 'rate',
      message: `UPS rates count=${upsRates.length}`,
      details: res.diagnostics || {},
    });
    if (payload.preferProviderOnly && upsRates.length === 0) {
      throw new AppError(422, 'No UPS rates for this route', 'SHIPPING_NO_RATES');
    }
    return { provider: 'ups', shipmentId: res.shipmentId || null, rates: upsRates, diagnostics: res.diagnostics };
  } catch (e) {
    await appendShippingLog({
      providerSlug: 'ups',
      level: 'ERROR',
      action: 'rate',
      message: e?.message || String(e),
      details: { code: e?.code },
    });
    if (payload.preferProviderOnly) {
      throw e instanceof AppError ? e : new AppError(e.statusCode || 502, e.message, e.code, e.details);
    }
    const fb = fallbackQuote(payload.shippingAddress || payload.toAddress || {});
    return { provider: fb.provider, shipmentId: null, rates: [fallbackRateFromQuote(fb)] };
  }
}

export async function orchestratorGenerateLabel(payload = {}) {
  const parsed = parseRateId(payload.rateId);
  if (parsed.kind === 'ups') {
    const { providers } = await loadShippingConfig();
    const row = providers.find((p) => p.slug === 'ups' && p.enabled);
    if (!row) {
      throw new AppError(503, 'UPS provider is disabled', 'UPS_DISABLED');
    }
    return upsProv.upsBuyLabel(row, payload);
  }
  throw new AppError(
    400,
    'Only UPS rates are supported. Open shipping options again and choose a UPS service.',
    'NON_UPS_RATE_UNSUPPORTED'
  );
}

export async function orchestratorTrackShipment(carrier, trackingNumber) {
  const { providers } = await loadShippingConfig();
  const row = providers.find((p) => p.slug === 'ups');
  return upsProv.upsTrack(trackingNumber, row);
}

export async function orchestratorCreateShipment(payload) {
  const { providers } = await loadShippingConfig();
  const row = providers.find((p) => p.slug === 'ups' && p.enabled);
  if (!row) {
    throw new AppError(503, 'UPS provider is not enabled', 'UPS_DISABLED');
  }
  const res = await upsProv.upsGetRates(row, payload, ['*']);
  return {
    provider: 'ups',
    shipmentId: res.shipmentId,
    rates: res.rates || [],
    raw: null,
  };
}
