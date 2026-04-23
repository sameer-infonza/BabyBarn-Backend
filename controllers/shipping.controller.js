import { PrismaClient } from '@prisma/client';
import { shippingService } from '../services/shipping.service.js';
import { validate } from '../utils/validation.js';
import {
  shippingRatesSchema,
  shippingShipmentSchema,
  shippingLabelSchema,
} from '../schemas/index.js';
import { AppError } from '../utils/error-handler.js';
import { toPublicJson } from '../utils/serialize.js';

const prisma = new PrismaClient();

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class ShippingController {
  async debugRateCheck(req, res) {
    const body = await validate(shippingRatesSchema, req.body ?? {});

    const run = async (country) => {
      try {
        const data = await shippingService.getRates({
          ...body,
          useDummyAddress: true,
          dummyCountry: country,
          preferProviderOnly: true,
        });
        return {
          country,
          ok: true,
          rateCount: Array.isArray(data?.rates) ? data.rates.length : 0,
          cheapest: data?.rates?.[0] || null,
          providers: [...new Set((data?.rates || []).map((rate) => String(rate?.provider || '')).filter(Boolean))],
          diagnostics: data?.diagnostics || null,
        };
      } catch (error) {
        return {
          country,
          ok: false,
          rateCount: 0,
          error: {
            code: error?.code || 'RATE_CHECK_FAILED',
            message: error?.message || 'Rate check failed',
            details: error?.details || null,
          },
        };
      }
    };

    const [us, ca] = await Promise.all([run('US'), run('CA')]);
    const usProviders = new Set((us?.providers || []).map((provider) => String(provider || '')));
    const caProviders = new Set((ca?.providers || []).map((provider) => String(provider || '')));
    const providerIntersection = [...usProviders].filter((p) => caProviders.has(p));
    const warnings = [];
    if (!us.ok || !ca.ok) {
      warnings.push('One or more country checks failed; verify Shippo account carrier activation.');
    }
    if (us.ok && ca.ok && providerIntersection.length === 0) {
      warnings.push('No shared carriers between US and CA in current account/mode.');
    }

    const checks = [
      'Address fields: city/state/zip/country normalized',
      'Carrier availability in Shippo account',
      'Test vs live mode parity',
      'Parcel units and values (lb/in or kg/cm)',
      'Origin address completeness',
      'Selected rate freshness (reject stale selectedRateId on checkout)',
    ];

    res.status(200).json({
      success: true,
      data: toPublicJson({
        mode: String(process.env.SHIPPO_API_KEY || '').startsWith('shippo_test_') ? 'test' : 'live',
        comparison: { us, ca },
        checks,
        warnings,
      }),
    });
  }

  async getRates(req, res) {
    const body = await validate(shippingRatesSchema, req.body ?? {});
    const data = await shippingService.getRates({ ...body, preferProviderOnly: true });
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async createShipment(req, res) {
    const body = await validate(shippingShipmentSchema, req.body ?? {});
    const data = await shippingService.createShipment(body);
    res.status(201).json({ success: true, data: toPublicJson(data) });
  }

  async generateLabel(req, res) {
    const body = await validate(shippingLabelSchema, req.body ?? {});
    const label = await shippingService.generateLabel(body);
    if (body.orderId && label.trackingNumber) {
      await prisma.order.updateMany({
        where: { publicId: body.orderId },
        data: {
          trackingNumber: label.trackingNumber,
          shippingCarrier: label.shippingCarrier || undefined,
          shippingLabelUrl: label.shippingLabelUrl || undefined,
          shippingTransactionId: label.transactionId || undefined,
          status: 'SHIPPED',
        },
      });
    }
    res.status(201).json({ success: true, data: toPublicJson(label) });
  }

  async track(req, res) {
    const carrier = String(req.params.carrier || '').trim();
    const trackingNumber = String(req.params.trackingNumber || '').trim();
    const data = await shippingService.trackShipment(carrier, trackingNumber);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  }

  async shippoWebhook(req, res) {
    const signature =
      req.headers['x-shippo-signature'] ||
      req.headers['shippo-signature'] ||
      req.headers['x-shippo-signature-v1'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const valid = shippingService.verifyShippoWebhook(rawBody, signature);
    if (!valid) {
      throw new AppError(401, 'Invalid Shippo webhook signature', 'SHIPPO_WEBHOOK_SIGNATURE_INVALID');
    }

    const event = req.body || {};
    if (event.event === 'track_updated') {
      const trackingNumber = event?.data?.tracking_number;
      const carrier = event?.data?.carrier;
      const status = event?.data?.tracking_status?.status;
      if (trackingNumber && carrier) {
        await prisma.order.updateMany({
          where: {
            trackingNumber: String(trackingNumber),
            shippingCarrier: { contains: String(carrier), mode: 'insensitive' },
          },
          data: {
            ...(status === 'DELIVERED' ? { status: 'DELIVERED' } : {}),
            trackingStatus: status || null,
            trackingStatusDetails: event?.data?.tracking_status?.status_details || null,
            trackingStatusDate: parseDateOrNull(event?.data?.tracking_status?.status_date),
            trackingEta: parseDateOrNull(event?.data?.eta),
            trackingHistoryJson: Array.isArray(event?.data?.tracking_history)
              ? event.data.tracking_history
              : [],
          },
        });
      }
    }

    res.status(200).json({ success: true, received: true });
  }
}

export const shippingController = new ShippingController();
