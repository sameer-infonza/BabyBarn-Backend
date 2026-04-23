import axios from 'axios';
import crypto from 'crypto';

function baseUrl() {
  return (process.env.SHIPPO_BASE_URL || 'https://api.goshippo.com').replace(/\/$/, '');
}

function headers() {
  return {
    Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY || ''}`,
    'Content-Type': 'application/json',
  };
}

function normalizeShippoError(error) {
  if (error?.response) {
    return {
      statusCode: Number(error.response.status) || 502,
      code: 'SHIPPO_API_ERROR',
      message: error.response.data?.detail || error.response.data?.error || 'Shippo request failed',
      details: error.response.data,
    };
  }
  return {
    statusCode: 502,
    code: 'SHIPPO_API_ERROR',
    message: error?.message || 'Shippo request failed',
  };
}

export class ShippoClient {
  constructor() {
    this.http = axios.create({
      baseURL: baseUrl(),
      timeout: parseInt(process.env.SHIPPO_TIMEOUT_MS || '12000', 10),
      headers: headers(),
    });
  }

  hasKey() {
    return Boolean(String(process.env.SHIPPO_API_KEY || '').trim());
  }

  assertConfigured() {
    if (!this.hasKey()) {
      throw {
        statusCode: 500,
        code: 'SHIPPO_NOT_CONFIGURED',
        message: 'Shippo API key is not configured',
      };
    }
  }

  async createShipment(payload) {
    this.assertConfigured();
    try {
      const { data } = await this.http.post('/shipments/', payload);
      return data;
    } catch (error) {
      throw normalizeShippoError(error);
    }
  }

  async buyLabel(payload) {
    this.assertConfigured();
    try {
      const { data } = await this.http.post('/transactions/', payload);
      return data;
    } catch (error) {
      throw normalizeShippoError(error);
    }
  }

  async track(carrier, trackingNumber) {
    this.assertConfigured();
    try {
      const { data } = await this.http.get(`/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`);
      return data;
    } catch (error) {
      throw normalizeShippoError(error);
    }
  }

  verifyWebhookSignature(rawBodyBuffer, signatureHeader) {
    const secret = String(process.env.SHIPPO_WEBHOOK_SECRET || '').trim();
    if (!secret) return true;
    if (!signatureHeader || !rawBodyBuffer) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBodyBuffer).digest('hex');
    const actual = String(signatureHeader).trim();
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  }
}

export const shippoClient = new ShippoClient();
