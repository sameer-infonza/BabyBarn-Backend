import { AppError } from '../utils/error-handler.js';
import {
  toShippoAddress,
  defaultFromAddress,
} from './shipping/shipping-address.js';
import {
  orchestratorGetRates,
  orchestratorGenerateLabel,
  orchestratorTrackShipment,
  orchestratorCreateShipment,
} from './shipping/shipping-orchestrator.js';
import { encodeFallbackRateId } from './shipping/rate-id.js';

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
  const zone = String(quote.zone || 'unknown');
  const amount = Number(quote.cost || 0);
  return {
    rateId: encodeFallbackRateId({ zone, a: amount }),
    provider: quote.provider || 'fallback',
    serviceLevel: 'Standard',
    serviceToken: zone,
    currency: 'USD',
    amount,
    estimatedDays: zone === 'us_domestic' ? 5 : null,
    attributes: [],
    durationTerms: quote.description || null,
    providerSlug: 'fallback',
  };
}

export class ShippingService {
  getConfiguredOriginAddress() {
    return toShippoAddress(defaultFromAddress());
  }

  async estimateByAddress(address) {
    const quote = await this.describeQuote(address);
    return quote.cost;
  }

  async describeQuote(address) {
    const fallback = fallbackQuote(address);
    const ratesData = await orchestratorGetRates({
      shippingAddress: address,
      preferProviderOnly: false,
      surface: 'checkout',
    });
    const cheapest = ratesData.rates[0];
    if (!cheapest) return fallback;
    return {
      cost: Number(cheapest.amount ?? cheapest.cost ?? 0),
      zone: 'dynamic',
      description: `${cheapest.provider} ${cheapest.serviceLevel || 'shipping'} rate`,
      provider: cheapest.provider || ratesData.provider || 'UPS',
    };
  }

  async getRates(payload = {}) {
    return orchestratorGetRates(payload);
  }

  async createShipment(payload = {}) {
    return orchestratorCreateShipment(payload);
  }

  async generateLabel(payload = {}) {
    return orchestratorGenerateLabel(payload);
  }

  async trackShipment(carrier, trackingNumber) {
    if (!carrier || !trackingNumber) {
      throw new AppError(400, 'carrier and trackingNumber are required', 'TRACKING_INVALID');
    }
    try {
      return await orchestratorTrackShipment(carrier, trackingNumber);
    } catch (error) {
      throw new AppError(error.statusCode || 502, error.message, error.code, error.details);
    }
  }

  verifyShippoWebhook(_rawBody, _signatureHeader) {
    return false;
  }
}

export const shippingService = new ShippingService();
