import { config } from '../config/env.js';

/**
 * Pluggable shipping-address verification.
 *
 * Supports USPS Addresses v3 and UPS Address Validation. The active provider is
 * selected from configured credentials (see config.addressVerification). When no
 * provider is configured the service is a no-op so address creation keeps working
 * exactly as before — the client can drop in credentials later with zero code
 * changes.
 *
 * verifyAddress() never throws on provider/network errors; it degrades to
 * { status: 'skipped' } unless ADDRESS_VERIFY_STRICT is set, in which case
 * undeliverable addresses surface as { deliverable: false } for the caller to act on.
 */

const TOKEN_SKEW_MS = 30_000;

class AddressVerificationService {
  constructor() {
    this._tokenCache = new Map(); // provider -> { token, expiresAt }
  }

  /** Resolve the active provider from config + available credentials. */
  activeProvider() {
    const cfg = config.addressVerification;
    const uspsReady = Boolean(cfg.usps.clientId && cfg.usps.clientSecret);
    const upsReady = Boolean(cfg.ups.clientId && cfg.ups.clientSecret);
    if (cfg.provider === 'usps') return uspsReady ? 'usps' : null;
    if (cfg.provider === 'ups') return upsReady ? 'ups' : null;
    if (cfg.provider === 'none') return null;
    // auto
    if (uspsReady) return 'usps';
    if (upsReady) return 'ups';
    return null;
  }

  isEnabled() {
    return this.activeProvider() !== null;
  }

  /**
   * @param {{addressLine1?:string,addressLine2?:string,city?:string,state?:string,zipCode?:string,country?:string}} address
   * @returns {Promise<{status:'verified'|'corrected'|'unverified'|'skipped', deliverable:boolean, normalized:object|null, messages:string[]}>}
   */
  async verifyAddress(address) {
    const provider = this.activeProvider();
    if (!provider) {
      return { status: 'skipped', deliverable: true, normalized: null, messages: [] };
    }
    // Only US addresses are supported by USPS/UPS domestic validation here.
    const country = String(address?.country || 'US').trim().toUpperCase();
    if (country !== 'US' && country !== 'USA' && country !== 'UNITED STATES') {
      return { status: 'skipped', deliverable: true, normalized: null, messages: [] };
    }

    try {
      if (provider === 'usps') return await this._verifyWithUsps(address);
      return await this._verifyWithUps(address);
    } catch (err) {
      console.error(`[address-verify] ${provider} verification failed`, err?.message || err);
      return {
        status: 'skipped',
        deliverable: true,
        normalized: null,
        messages: ['Address verification is temporarily unavailable.'],
      };
    }
  }

  async _getToken(provider) {
    const cached = this._tokenCache.get(provider);
    if (cached && cached.expiresAt - TOKEN_SKEW_MS > Date.now()) return cached.token;

    const token =
      provider === 'usps' ? await this._fetchUspsToken() : await this._fetchUpsToken();
    return token;
  }

  async _fetchUspsToken() {
    const { clientId, clientSecret, baseUrl } = config.addressVerification.usps;
    const res = await fetch(`${baseUrl}/oauth2/v3/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) throw new Error(`USPS token HTTP ${res.status}`);
    const data = await res.json();
    const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
    this._tokenCache.set('usps', {
      token: data.access_token,
      expiresAt: Date.now() + expiresInMs,
    });
    return data.access_token;
  }

  async _fetchUpsToken() {
    const { clientId, clientSecret, baseUrl } = config.addressVerification.ups;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(`${baseUrl}/security/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`UPS token HTTP ${res.status}`);
    const data = await res.json();
    const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
    this._tokenCache.set('ups', {
      token: data.access_token,
      expiresAt: Date.now() + expiresInMs,
    });
    return data.access_token;
  }

  async _verifyWithUsps(address) {
    const { baseUrl } = config.addressVerification.usps;
    const token = await this._getToken('usps');
    const params = new URLSearchParams();
    if (address.addressLine1) params.set('streetAddress', address.addressLine1);
    if (address.addressLine2) params.set('secondaryAddress', address.addressLine2);
    if (address.city) params.set('city', address.city);
    if (address.state) params.set('state', address.state);
    if (address.zipCode) {
      const [zip5, zip4] = String(address.zipCode).split('-');
      if (zip5) params.set('ZIPCode', zip5.trim());
      if (zip4) params.set('ZIPPlus4', zip4.trim());
    }

    const res = await fetch(`${baseUrl}/addresses/v3/address?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 400 || res.status === 404) {
      return {
        status: 'unverified',
        deliverable: false,
        normalized: null,
        messages: ['We could not verify this address. Please double-check it.'],
      };
    }
    if (!res.ok) throw new Error(`USPS address HTTP ${res.status}`);
    const data = await res.json();
    const a = data.address || {};
    const normalized = {
      addressLine1: a.streetAddress || address.addressLine1,
      addressLine2: a.secondaryAddress || address.addressLine2 || null,
      city: a.city || address.city,
      state: a.state || address.state,
      zipCode: a.ZIPPlus4 ? `${a.ZIPCode}-${a.ZIPPlus4}` : a.ZIPCode || address.zipCode,
      country: 'US',
    };
    const changed = this._isChanged(address, normalized);
    return {
      status: changed ? 'corrected' : 'verified',
      deliverable: true,
      normalized,
      messages: changed ? ['Address standardized to the USPS-recognized format.'] : [],
    };
  }

  async _verifyWithUps(address) {
    const { baseUrl } = config.addressVerification.ups;
    const token = await this._getToken('ups');
    const body = {
      XAVRequest: {
        AddressKeyFormat: {
          AddressLine: [address.addressLine1, address.addressLine2].filter(Boolean),
          PoliticalDivision2: address.city,
          PoliticalDivision1: address.state,
          PostcodePrimaryLow: String(address.zipCode || '').split('-')[0],
          CountryCode: 'US',
        },
      },
    };
    // requestoption=1 → address validation
    const res = await fetch(`${baseUrl}/api/addressvalidation/v2/1`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`UPS address HTTP ${res.status}`);
    const data = await res.json();
    const xav = data.XAVResponse || {};
    const noCandidates = xav.NoCandidatesIndicator !== undefined;
    if (noCandidates) {
      return {
        status: 'unverified',
        deliverable: false,
        normalized: null,
        messages: ['We could not verify this address. Please double-check it.'],
      };
    }
    const candidateRaw = Array.isArray(xav.Candidate) ? xav.Candidate[0] : xav.Candidate;
    const akf = candidateRaw?.AddressKeyFormat || {};
    const lines = Array.isArray(akf.AddressLine) ? akf.AddressLine : [akf.AddressLine].filter(Boolean);
    const normalized = {
      addressLine1: lines[0] || address.addressLine1,
      addressLine2: lines[1] || address.addressLine2 || null,
      city: akf.PoliticalDivision2 || address.city,
      state: akf.PoliticalDivision1 || address.state,
      zipCode: akf.PostcodeExtendedLow
        ? `${akf.PostcodePrimaryLow}-${akf.PostcodeExtendedLow}`
        : akf.PostcodePrimaryLow || address.zipCode,
      country: 'US',
    };
    const changed = this._isChanged(address, normalized);
    return {
      status: changed ? 'corrected' : 'verified',
      deliverable: true,
      normalized,
      messages: changed ? ['Address standardized to the carrier-recognized format.'] : [],
    };
  }

  _isChanged(original, normalized) {
    const norm = (v) => String(v ?? '').trim().toUpperCase();
    return (
      norm(original.addressLine1) !== norm(normalized.addressLine1) ||
      norm(original.addressLine2) !== norm(normalized.addressLine2) ||
      norm(original.city) !== norm(normalized.city) ||
      norm(original.state) !== norm(normalized.state) ||
      norm(original.zipCode) !== norm(normalized.zipCode)
    );
  }
}

export const addressVerificationService = new AddressVerificationService();
