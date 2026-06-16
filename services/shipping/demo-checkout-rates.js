import { encodeDemoRateId } from './rate-id.js';

const DEMO_PICKUP_LINE = '444 Hayes St., San Francisco, CA';

/**
 * Checkout demo rates when UPS is not configured (client demos).
 * Replaced automatically by live UPS rates once credentials are saved in admin.
 */
export function buildDemoCheckoutRates({ hasAccess = false } = {}) {
  const groundAmount = hasAccess ? 0 : 7.99;

  return [
    {
      rateId: encodeDemoRateId({ code: 'ground', a: groundAmount }),
      provider: 'UPS',
      serviceLevel: 'Ground',
      serviceToken: 'demo-ground',
      currency: 'USD',
      amount: groundAmount,
      estimatedDays: 3,
      attributes: hasAccess ? ['access_free'] : [],
      durationTerms: null,
      providerSlug: 'demo',
      externalRateId: 'demo-ground',
    },
    {
      rateId: encodeDemoRateId({ code: '2day', a: 14 }),
      provider: 'UPS',
      serviceLevel: '2-Day Air',
      serviceToken: 'demo-2day',
      currency: 'USD',
      amount: 14,
      estimatedDays: 2,
      attributes: [],
      durationTerms: null,
      providerSlug: 'demo',
      externalRateId: 'demo-2day',
    },
    {
      rateId: encodeDemoRateId({ code: 'nextday', a: 28 }),
      provider: 'UPS',
      serviceLevel: 'Next Day Saver',
      serviceToken: 'demo-nextday',
      currency: 'USD',
      amount: 28,
      estimatedDays: 1,
      attributes: [],
      durationTerms: null,
      providerSlug: 'demo',
      externalRateId: 'demo-nextday',
    },
  ];
}

export function isDemoRatesResponse(provider, diagnostics) {
  if (String(provider || '').toLowerCase() === 'demo') return true;
  return String(diagnostics?.mode || '').toLowerCase() === 'demo';
}
