import { AppError } from '../utils/error-handler.js';
import { shippoClient } from './providers/shippo.client.js';

function normalizeCountry(country) {
  const c = String(country || '').trim().toUpperCase();
  if (!c) return 'US';
  if (['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(c)) return 'US';
  if (['CA', 'CAN', 'CANADA'].includes(c)) return 'CA';
  return c;
}

function normalizePostalCode(zip, countryCode) {
  const raw = String(zip || '').trim();
  if (!raw) return '';
  if (countryCode === 'US') {
    const digits = raw.replace(/[^\d-]/g, '');
    return digits.slice(0, 10);
  }
  if (countryCode === 'CA') {
    return raw.toUpperCase().replace(/\s+/g, '').replace(/(.{3})/, '$1 ').trim();
  }
  return raw;
}

function normalizeState(state, countryCode) {
  const s = String(state || '').trim();
  if (!s) return '';
  if (countryCode === 'US' || countryCode === 'CA') return s.toUpperCase();
  return s;
}

function sanitizeParcel(p) {
  return {
    length: String(p.length),
    width: String(p.width),
    height: String(p.height),
    weight: String(p.weight),
    distance_unit: String(p.distance_unit || process.env.SHIP_DEFAULT_DISTANCE_UNIT || 'in'),
    mass_unit: String(p.mass_unit || process.env.SHIP_DEFAULT_MASS_UNIT || 'lb'),
  };
}

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

function toShippoAddress(address = {}) {
  const country = normalizeCountry(address.country);
  return {
    name: String(address.fullName || address.name || '').trim() || 'Recipient',
    street1: String(address.addressLine1 || address.street1 || '').trim(),
    street2: String(address.addressLine2 || address.street2 || '').trim() || undefined,
    city: String(address.city || '').trim(),
    state: normalizeState(address.state, country),
    zip: normalizePostalCode(address.zipCode || address.zip, country),
    country,
    phone: String(address.phoneNumber || address.phone || '').trim() || undefined,
    email: String(address.email || '').trim() || undefined,
    validate: false,
  };
}

function defaultFromAddress() {
  return {
    name: String(process.env.SHIP_FROM_NAME || 'Baby Barn Warehouse').trim(),
    company: String(process.env.SHIP_FROM_COMPANY || 'Baby Barn').trim(),
    street1: String(process.env.SHIP_FROM_STREET1 || '').trim(),
    street2: String(process.env.SHIP_FROM_STREET2 || '').trim() || undefined,
    city: String(process.env.SHIP_FROM_CITY || '').trim(),
    state: String(process.env.SHIP_FROM_STATE || '').trim(),
    zip: String(process.env.SHIP_FROM_ZIP || '').trim(),
    country: String(process.env.SHIP_FROM_COUNTRY || 'US').trim(),
    phone: String(process.env.SHIP_FROM_PHONE || '').trim() || undefined,
    email: String(process.env.SHIP_FROM_EMAIL || '').trim() || undefined,
    validate: false,
  };
}

function hasCompleteAddress(address) {
  return Boolean(
    address &&
      String(address.street1 || '').trim() &&
      String(address.city || '').trim() &&
      String(address.state || '').trim() &&
      String(address.zip || '').trim() &&
      String(address.country || '').trim()
  );
}

function defaultParcel() {
  return {
    length: String(process.env.SHIP_DEFAULT_PARCEL_LENGTH || '10'),
    width: String(process.env.SHIP_DEFAULT_PARCEL_WIDTH || '8'),
    height: String(process.env.SHIP_DEFAULT_PARCEL_HEIGHT || '4'),
    distance_unit: String(process.env.SHIP_DEFAULT_DISTANCE_UNIT || 'in'),
    weight: String(process.env.SHIP_DEFAULT_WEIGHT || '1'),
    mass_unit: String(process.env.SHIP_DEFAULT_MASS_UNIT || 'lb'),
  };
}

function dummyAddress(countryCode = 'US') {
  const c = normalizeCountry(countryCode);
  if (c === 'CA') {
    return {
      name: 'Dummy Receiver',
      street1: '111 Richmond St W',
      city: 'Toronto',
      state: 'ON',
      zip: 'M5H 2G4',
      country: 'CA',
      phone: '+14165550123',
      email: 'dummy.ca@example.com',
      validate: false,
    };
  }
  return {
    name: 'Dummy Receiver',
    street1: '1600 Amphitheatre Pkwy',
    city: 'Mountain View',
    state: 'CA',
    zip: '94043',
    country: 'US',
    phone: '+16505550123',
    email: 'dummy.us@example.com',
    validate: false,
  };
}

function mapRate(rate) {
  return {
    rateId: rate.object_id,
    provider: rate.provider,
    serviceLevel: rate.servicelevel?.name || null,
    serviceToken: rate.servicelevel?.token || null,
    currency: rate.currency,
    amount: Number(rate.amount || 0),
    estimatedDays: rate.estimated_days ?? null,
    attributes: Array.isArray(rate.attributes) ? rate.attributes : [],
    durationTerms: rate.duration_terms || null,
  };
}

function mapTracking(data, carrier, trackingNumber) {
  return {
    carrier,
    trackingNumber,
    status: data?.tracking_status?.status || 'UNKNOWN',
    statusDetails: data?.tracking_status?.status_details || null,
    statusDate: data?.tracking_status?.status_date || null,
    eta: data?.eta || null,
    history: Array.isArray(data?.tracking_history) ? data.tracking_history : [],
    addressFrom: data?.address_from || null,
    addressTo: data?.address_to || null,
    raw: data,
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
    const ratesData = await this.getRates({
      shippingAddress: address,
      preferProviderOnly: false,
    });
    const cheapest = ratesData.rates[0];
    if (!cheapest) return fallback;
    return {
      cost: Number(cheapest.amount ?? cheapest.cost ?? 0),
      zone: 'dynamic',
      description: `${cheapest.provider} ${cheapest.serviceLevel || 'shipping'} rate`,
      provider: cheapest.provider || 'shippo',
    };
  }

  async getRates(payload = {}) {
    const useDummyAddress = Boolean(payload.useDummyAddress);
    const dummyCountry = String(payload.dummyCountry || 'US').trim();
    const toAddress = useDummyAddress
      ? dummyAddress(dummyCountry)
      : toShippoAddress(payload.shippingAddress || payload.toAddress || {});
    const fromAddress = payload.useDummyFromAddress
      ? dummyAddress('US')
      : toShippoAddress(payload.fromAddress || defaultFromAddress());
    const parcels = Array.isArray(payload.parcels) && payload.parcels.length > 0
      ? payload.parcels.map(sanitizeParcel)
      : [defaultParcel()];

    if (!hasCompleteAddress(toAddress)) {
      const fallback = fallbackQuote(payload.shippingAddress || payload.toAddress || {});
      return { provider: fallback.provider, shipmentId: null, rates: [fallbackRateFromQuote(fallback)] };
    }

    if (!hasCompleteAddress(fromAddress) || !shippoClient.hasKey()) {
      if (payload.preferProviderOnly) {
        throw new AppError(500, 'Shippo is not fully configured', 'SHIPPO_NOT_CONFIGURED');
      }
      const fallback = fallbackQuote(payload.shippingAddress || payload.toAddress || {});
      return { provider: fallback.provider, shipmentId: null, rates: [fallbackRateFromQuote(fallback)] };
    }

    try {
      const shipment = await shippoClient.createShipment({
        address_from: fromAddress,
        address_to: toAddress,
        parcels,
        async: false,
      });
      const rates = (shipment.rates || [])
        .map(mapRate)
        .sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
      if (payload.preferProviderOnly && rates.length === 0) {
        throw new AppError(422, 'No shipping rates returned by Shippo for this route', 'SHIPPO_NO_RATES', {
          objectState: shipment.object_state,
          messages: shipment.messages || [],
          addressFrom: fromAddress,
          addressTo: toAddress,
          parcels,
          mode: String(process.env.SHIPPO_API_KEY || '').startsWith('shippo_test_') ? 'test' : 'live',
        });
      }
      return {
        provider: 'shippo',
        shipmentId: shipment.object_id,
        rates,
        diagnostics: {
          mode: String(process.env.SHIPPO_API_KEY || '').startsWith('shippo_test_') ? 'test' : 'live',
          objectState: shipment.object_state || null,
          messages: shipment.messages || [],
          usedDummyAddress: useDummyAddress,
          addressFrom: fromAddress,
          addressTo: toAddress,
          parcels,
        },
      };
    } catch (error) {
      if (payload.preferProviderOnly) {
        throw new AppError(error.statusCode || 502, error.message, error.code, error.details);
      }
      const fallback = fallbackQuote(payload.shippingAddress || payload.toAddress || {});
      return { provider: fallback.provider, shipmentId: null, rates: [fallbackRateFromQuote(fallback)] };
    }
  }

  async createShipment(payload = {}) {
    const toAddress = toShippoAddress(payload.shippingAddress || payload.toAddress || {});
    const fromAddress = toShippoAddress(payload.fromAddress || defaultFromAddress());
    const parcels = Array.isArray(payload.parcels) && payload.parcels.length > 0
      ? payload.parcels
      : [defaultParcel()];
    if (!hasCompleteAddress(toAddress)) {
      throw new AppError(400, 'Valid destination address is required', 'SHIPPING_ADDRESS_INVALID');
    }
    if (!hasCompleteAddress(fromAddress)) {
      throw new AppError(500, 'Origin shipping address is not configured', 'SHIP_FROM_NOT_CONFIGURED');
    }
    try {
      const shipment = await shippoClient.createShipment({
        address_from: fromAddress,
        address_to: toAddress,
        parcels,
        async: false,
        metadata: payload.metadata || null,
      });
      return {
        provider: 'shippo',
        shipmentId: shipment.object_id,
        rates: (shipment.rates || []).map(mapRate),
        raw: shipment,
      };
    } catch (error) {
      throw new AppError(error.statusCode || 502, error.message, error.code, error.details);
    }
  }

  async generateLabel(payload = {}) {
    const rateId = String(payload.rateId || payload.rate || '').trim();
    if (!rateId) {
      throw new AppError(400, 'rateId is required to buy a label', 'SHIP_LABEL_RATE_REQUIRED');
    }
    try {
      const tx = await shippoClient.buyLabel({
        rate: rateId,
        label_file_type: payload.labelFileType || 'PDF_4x6',
        async: false,
      });
      return {
        provider: 'shippo',
        transactionId: tx.object_id,
        status: tx.status,
        trackingNumber: tx.tracking_number || null,
        shippingCarrier: tx.tracking_status?.carrier || tx.rate?.provider || null,
        shippingLabelUrl: tx.label_url || null,
        qrCodeUrl: tx.qr_code_url || null,
        messages: tx.messages || [],
        raw: tx,
      };
    } catch (error) {
      throw new AppError(error.statusCode || 502, error.message, error.code, error.details);
    }
  }

  async trackShipment(carrier, trackingNumber) {
    if (!carrier || !trackingNumber) {
      throw new AppError(400, 'carrier and trackingNumber are required', 'TRACKING_INVALID');
    }
    try {
      const data = await shippoClient.track(carrier, trackingNumber);
      return mapTracking(data, carrier, trackingNumber);
    } catch (error) {
      throw new AppError(error.statusCode || 502, error.message, error.code, error.details);
    }
  }

  verifyShippoWebhook(rawBody, signatureHeader) {
    return shippoClient.verifyWebhookSignature(rawBody, signatureHeader);
  }
}

export const shippingService = new ShippingService();
